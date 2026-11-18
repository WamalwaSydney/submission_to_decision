"""Load, burst and rate-limit measurements against a running Participation Trace API.

Usage (with the Docker stack running):
    python evaluation/load_test.py                          # local stack, http://localhost:8001
    python evaluation/load_test.py --runs 200 --burst 50
    python evaluation/load_test.py --base https://submission-to-decision.onrender.com --no-stats

1. Load test: --runs sequential requests to each endpoint; median and 95th-percentile times.
2. Burst: --burst requests sent at once; median, 95th percentile and throughput (requests per second),
   with `docker stats` for the API and database containers captured while the burst runs.
3. Rate limit: 110 requests from one client address; the API allows 100 a minute, so the last 10 get 429.

The API limits each client address to 100 requests a minute. In the load test and the burst each request
carries its own address (X-Forwarded-For), as if many citizens used the site at once, so the limit does
not cap the measurement. The rate-limit test uses a single address. Uses only the standard library.
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import ctypes
import os
import platform
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime

ENDPOINTS = [
    ("Health check", "/health"),
    ("Receipt lookup", "/api/v1/receipts/RCT-00F3CF"),
    ("Single receipt verification", "/api/v1/receipts/RCT-00F3CF/verify"),
    ("Full chain verification", "/api/v1/receipts/verify"),
    ("Bills list", "/api/v1/bills"),
    ("Start-up data (bootstrap)", "/api/v1/bootstrap"),
]
_counter = iter(range(1, 10**9))
_lock = threading.Lock()


def new_address() -> str:
    with _lock:
        n = next(_counter)
    return f"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}"


def request(base: str, path: str, address: str) -> tuple[int, float, int]:
    """(status, milliseconds, bytes received). Compressed responses are accepted, as a browser would."""
    req = urllib.request.Request(base + path, headers={"Accept-Encoding": "gzip", "X-Forwarded-For": address})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            body = response.read()
            return response.status, (time.perf_counter() - start) * 1000, len(body)
    except urllib.error.HTTPError as error:
        error.read()
        return error.code, (time.perf_counter() - start) * 1000, 0


def p95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, int(round(0.95 * len(ordered))) - 1)]


def machine() -> str:
    memory = ""
    if os.name == "nt":
        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                        ("avail", ctypes.c_ulonglong), ("pt", ctypes.c_ulonglong), ("pa", ctypes.c_ulonglong),
                        ("vt", ctypes.c_ulonglong), ("va", ctypes.c_ulonglong), ("ve", ctypes.c_ulonglong)]
        status = Status()
        status.length = ctypes.sizeof(Status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        memory = f", {status.total / 2**30:.1f} GB RAM"
    cpu = platform.processor()
    if os.name == "nt":
        try:
            cpu = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                                 capture_output=True, text=True, timeout=20).stdout.strip() or cpu
        except Exception:
            pass
    return f"{platform.system()} {platform.release()} ({platform.version()}), {cpu}, {os.cpu_count()} logical CPUs{memory}"


def rule(char: str = "=") -> None:
    print(char * 96)


def load_test(base: str, runs: int) -> None:
    rule()
    print(f"  1. LOAD TEST: {runs} sequential requests per endpoint (each with its own client address)")
    rule()
    print(f"  {'Endpoint':<30}{'Path':<38}{'OK':>6}{'Median ms':>11}{'p95 ms':>9}")
    rule("-")
    for name, path in ENDPOINTS:
        request(base, path, new_address())  # warm-up, not counted
        results = [request(base, path, new_address()) for _ in range(runs)]
        ok = [ms for status, ms, _ in results if status == 200]
        if ok:
            print(f"  {name:<30}{path:<38}{len(ok):>4}/{runs:<3}{statistics.median(ok):>9.1f}{p95(ok):>9.1f}")
        else:
            print(f"  {name:<30}{path:<38}{0:>4}/{runs:<3}{'-':>9}{'-':>9}   (status {results[0][0]})")
    print()


def docker_stats(output: list[str]) -> None:
    try:
        done = subprocess.run(["docker", "stats", "--no-stream", "--format",
                               "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}"],
                              capture_output=True, text=True, timeout=60)
        lines = done.stdout.strip().splitlines()
        output.extend(line for i, line in enumerate(lines) if i == 0 or line.startswith(("submission_to_decision-backend", "submission_to_decision-postgres")))
    except Exception as exc:
        output.append(f"docker stats unavailable: {exc}")


def burst(base: str, path: str, size: int, rounds: int, stats: bool) -> None:
    rule()
    print(f"  2. BURST: {size} requests sent at once to {path}, {rounds} rounds (each with its own client address)")
    rule()
    captured: list[str] = []
    all_ms: list[float] = []
    total_requests = ok_count = 0
    started = time.perf_counter()
    stats_thread = threading.Thread(target=docker_stats, args=(captured,)) if stats else None
    with futures.ThreadPoolExecutor(max_workers=size) as pool:
        for round_number in range(rounds):
            if stats_thread and round_number == 0:
                stats_thread.start()  # sampled while the burst is running
            results = list(pool.map(lambda _: request(base, path, new_address()), range(size)))
            total_requests += len(results)
            ok_count += sum(1 for status, _, _ in results if status == 200)
            all_ms += [ms for status, ms, _ in results if status == 200]
    elapsed = time.perf_counter() - started
    if stats_thread:
        stats_thread.join()
    print(f"  Requests            {total_requests} ({ok_count} OK)")
    print(f"  Wall time           {elapsed:.2f} s")
    print(f"  Throughput          {total_requests / elapsed:.1f} requests per second")
    if all_ms:
        print(f"  Median              {statistics.median(all_ms):.1f} ms")
        print(f"  95th percentile     {p95(all_ms):.1f} ms")
        print(f"  Slowest             {max(all_ms):.1f} ms")
    if stats:
        print()
        print("  docker stats, captured during the burst:")
        for line in captured:
            print("    " + line)
    print()


def rate_limit(base: str) -> None:
    rule()
    print("  3. RATE LIMIT: 110 requests to /api/v1/receipts/RCT-00F3CF/verify from ONE client address (limit: 100 per minute)")
    rule()
    address = f"192.0.2.{uuid.uuid4().int % 250 + 1}"  # fresh test address, so earlier requests do not count
    results = [request(base, "/api/v1/receipts/RCT-00F3CF/verify", address)[0] for _ in range(110)]
    for number, status in enumerate(results, 1):
        if number <= 3 or number >= 98:
            print(f"  request {number:>3}: HTTP {status}{'  Too Many Requests' if status == 429 else ''}")
        elif number == 4:
            print("  ...")
    limited = [n for n, status in enumerate(results, 1) if status == 429]
    print()
    print(f"  {results.count(200)} returned 200 and {len(limited)} returned 429"
          + (f" (requests {limited[0]} to {limited[-1]})." if limited else "."))
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", default="http://localhost:8001")
    parser.add_argument("--runs", type=int, default=200, help="sequential requests per endpoint")
    parser.add_argument("--burst", type=int, default=50, help="requests sent at once")
    parser.add_argument("--burst-rounds", type=int, default=1, help="bursts back to back (more rounds give a steadier throughput figure)")
    parser.add_argument("--burst-path", default="/api/v1/bills")
    parser.add_argument("--no-stats", action="store_true", help="skip docker stats (e.g. against the hosted API)")
    parser.add_argument("--skip", choices=["load", "burst", "rate"], action="append", default=[])
    args = parser.parse_args()
    base = args.base.rstrip("/")
    rule()
    print(f"  Participation Trace performance run   {datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"  Target   {base}")
    print(f"  Machine  {machine()}")
    rule()
    print()
    if "load" not in args.skip:
        load_test(base, args.runs)
    if "burst" not in args.skip:
        burst(base, args.burst_path, args.burst, args.burst_rounds, not args.no_stats)
    if "rate" not in args.skip:
        rate_limit(base)
