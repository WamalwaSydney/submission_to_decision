"""Download every county Act PDF a county assembly publishes on its own Acts page.

Usage (inside the backend container):
    python -m app.scripts.download_county_acts                 # into /app/var/acts/county/<county>/
    python -m app.scripts.download_county_acts --dir /tmp/acts

Files already downloaded are skipped, so the command can be run again after a failure.
Only PDFs on the assembly's own domain are fetched, one at a time with a pause between them.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

import httpx

from app.scripts.sync_county_bills import COUNTIES, HEADERS, parse_assembly_acts

PAUSE_S = 2
MANIFEST = "manifest.json"  # which file is which Act, with its official address; read by act_library
MAX_BYTES = 150 * 1024 * 1024


RETRIES = 4


async def get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """GET with retries: the assembly's server often drops connections part-way."""
    for attempt in range(1, RETRIES + 1):
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response
        except httpx.HTTPError:
            if attempt == RETRIES:
                raise
            await asyncio.sleep(PAUSE_S * attempt * 3)
    raise AssertionError("unreachable")


def file_name(title: str, assented) -> str:
    stem = re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")[:150]
    return f"{assented.isoformat() + '_' if assented else ''}{stem}.pdf"


async def download_county(client: httpx.AsyncClient, county, folder: Path) -> tuple[int, int, int]:
    page = await get(client, county.acts_url)
    acts = parse_assembly_acts(page.text, str(page.url), county)
    folder.mkdir(parents=True, exist_ok=True)
    print(f"{county.institution}: {len(acts)} Acts -> {folder}", flush=True)
    got = skipped = failed = 0
    names: set[str] = set()
    manifest = []
    for i, (title, url, assented) in enumerate(acts, 1):
        name = file_name(title, assented)
        if name in names:  # the page lists some Acts twice (two copies of one Act)
            name = name[:-4] + f"_{i}.pdf"
        names.add(name)
        manifest.append({"file": name, "title": title, "url": url, "assented": assented.isoformat() if assented else None})
        # Written as we go, so act_library can load whatever is already downloaded.
        (folder / MANIFEST).write_text(json.dumps(manifest, indent=1))
        path = folder / name
        if path.exists() and path.stat().st_size > 0:
            skipped += 1
            continue
        try:
            response = await get(client, url)
            if not response.content.startswith(b"%PDF") or len(response.content) > MAX_BYTES:
                raise ValueError("not a PDF, or too large")
            path.write_bytes(response.content)
            got += 1
            print(f"  {i}/{len(acts)} {name} ({len(response.content) // 1024:,} KB)", flush=True)
        except (httpx.HTTPError, ValueError) as exc:
            failed += 1
            print(f"  {i}/{len(acts)} FAILED {title}: {exc or type(exc).__name__}\n      {url}", flush=True)
        await asyncio.sleep(PAUSE_S)
    return got, skipped, failed


async def run(base: Path) -> int:
    failures = 0
    timeout = httpx.Timeout(connect=30, read=180, write=30, pool=30)
    async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, follow_redirects=True) as client:
        for county in COUNTIES:
            if not county.acts_url:
                print(f"{county.institution}: no Acts page on its website, skipped", flush=True)
                continue
            got, skipped, failed = await download_county(client, county, base / county.key)
            failures += failed
            print(f"{county.institution}: {got} downloaded, {skipped} already there, {failed} failed", flush=True)
    if failures:
        print("Run the command again to retry the failed downloads.", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default="/app/var/acts/county", help="folder to save into (one subfolder per county)")
    raise SystemExit(asyncio.run(run(Path(parser.parse_args().dir))))
