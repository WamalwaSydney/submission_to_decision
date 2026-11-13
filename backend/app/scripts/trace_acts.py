"""Link assented bills to their final Act and check which committee recommendations made it into the law.

Usage (inside the backend container):
    python -m app.scripts.trace_acts --find
        Find each assented bill's Act on Kenya Law's public listing and store its title, number and link.
    python -m app.scripts.trace_acts --dir /app/var/acts
        Load Act PDFs you downloaded from Kenya Law (in a normal browser) into a folder. Each PDF is
        matched to its bill by the Act number or title printed in it, then checked with Gemini.
    python -m app.scripts.trace_acts --bill NA/2025/Bill-015 --file /app/var/acts/vasp.pdf
    python -m app.scripts.trace_acts --fetch
        Fetch the text of every linked Act from the Laws.Africa content API (needs LAWS_AFRICA_TOKEN),
        then check it.
    python -m app.scripts.trace_acts --parliament
        Download the Acts that Parliament publishes on its own Acts page (free; only some Acts are there),
        then check them.
    python -m app.scripts.trace_acts --list
        Print every linked Act's Kenya Law address, to download by hand.
    python -m app.scripts.trace_acts --check
        Re-check every stored Act.

Kenya Law blocks automated downloads of Act pages, so this script never fetches Act texts itself.
"""
from __future__ import annotations

import argparse
import asyncio
import re
from pathlib import Path

import httpx
from sqlalchemy import select

from app.database import async_session
from app.models import ActTrace, LegislativeItem
from app.services import act_trace_service, ingestion_service, llm_matching_service, report_analysis_service, storage_service

LISTING = "https://kenyalaw.org/legislation/all"
HEADERS = {"User-Agent": "ParticipationTrace/1.0 (civic-tech research; non-commercial)"}
MAX_PAGES = 15


async def kenya_law_acts(years: set[int]) -> list[dict]:
    acts: list[dict] = []
    async with httpx.AsyncClient(timeout=60, follow_redirects=True, headers=HEADERS) as client:
        for year in sorted(years):
            for page in range(1, MAX_PAGES + 1):
                response = await client.get(LISTING, params={"years": year, "page": page})
                if response.status_code != 200:
                    print(f"  Kenya Law listing {year} page {page}: HTTP {response.status_code}", flush=True)
                    break
                found = act_trace_service.parse_kenya_law_listing(response.text)
                acts.extend(found)
                if f"page={page + 1}" not in response.text:
                    break
                await asyncio.sleep(0.5)
    return list({act["url"]: act for act in acts}.values())


async def assented_bills(db) -> list[LegislativeItem]:
    return (await db.execute(select(LegislativeItem).where(
        LegislativeItem.is_simulated.is_(False), LegislativeItem.institution == "National Assembly",
    ))).scalars().all()


async def find(db) -> None:
    bills = [bill for bill in await assented_bills(db) if (bill.stage or "").strip().casefold() == "assented"]
    years = {year for bill in bills if bill.bill_year for year in range(bill.bill_year, bill.bill_year + 4)}
    acts = await kenya_law_acts(years)
    print(f"{len(acts)} Acts on Kenya Law for {len(years)} year(s); {len(bills)} assented bills", flush=True)
    linked = 0
    for bill in bills:
        act = act_trace_service.match_act(bill.title, bill.bill_year, acts)
        if not act:
            continue
        row = await act_trace_service.get_trace(db, bill.id)
        if row is None:
            row = ActTrace(bill_ref=bill.id, items=[])
            db.add(row)
        row.act_title, row.act_citation, row.act_url = act["title"], act["citation"], act["url"]
        linked += 1
    await db.commit()
    print(f"Linked {linked} bills to their Act on Kenya Law", flush=True)


def pdf_text(path: Path) -> str:
    text, _ = ingestion_service.extract_text(str(path))
    return text


def bill_for_text(text: str, bills: list[LegislativeItem], traces: dict) -> LegislativeItem | None:
    """Match an Act PDF to a bill: by the Act number printed in it, else by the Act's name."""
    head = re.sub(r"\s+", " ", text[:6000])
    numbers = {f"Act No. {int(n)} of {y}" for n, y in re.findall(r"\bNo\.?\s*(\d+)\s+of\s+(20\d{2})\b", head, re.I)}
    by_citation = [bill for bill in bills if traces.get(bill.id) and traces[bill.id].act_citation in numbers]
    if len(by_citation) == 1:
        return by_citation[0]
    normal = act_trace_service._normalise(head)
    by_title = [bill for bill in bills if (traces.get(bill.id) and traces[bill.id].act_title
                                         and act_trace_service._normalise(traces[bill.id].act_title) in normal)]
    return by_title[0] if len(by_title) == 1 else None


async def load(db, bill: LegislativeItem, path: Path, text: str) -> None:
    stored = storage_service.persist_report(path.read_bytes(), path.name)
    row = await act_trace_service.get_trace(db, bill.id)
    if row is None:
        row = ActTrace(bill_ref=bill.id, items=[])
        db.add(row)
    row.storage_ref, row.sha256, row.act_text = stored["storage_ref"], stored["sha256"], text
    row.act_title = row.act_title or re.sub(r"\bBill\b", "Act", bill.title)
    row.items, row.checked_at, row.model = [], None, None
    await db.commit()


async def check(db, bill_id) -> str:
    bill = await db.get(LegislativeItem, bill_id)
    title, documents = bill.title, list(bill.documents or [])
    row = await act_trace_service.get_trace(db, bill_id)
    analyses = await report_analysis_service.analyses_for_bills(db, [bill_id])
    items = (report_analysis_service.combine(analyses.get(bill_id, [])) or {}).get("items", [])
    if not act_trace_service.recommendations(items):
        return f"{title}: no adopted recommendations to check (analyse its committee report first)"
    bill_text = row.bill_text or await act_trace_service.fetch_bill_text(documents)
    await act_trace_service.run_trace(db, row, items, title, bill_text)
    line = act_trace_service.summary_line(row.items)
    await db.commit()
    return f"{title}: {line}{'' if bill_text else ' (bill as published not available)'}"


async def fetch(db) -> list:
    if not act_trace_service.laws_africa_configured():
        raise SystemExit("LAWS_AFRICA_TOKEN is not set. Get a free key at https://laws.africa/api/ or use --dir with downloaded PDFs.")
    rows = (await db.execute(select(ActTrace).where(ActTrace.act_url.is_not(None), ActTrace.act_text.is_(None)))).scalars().all()
    work = [(row.bill_ref, row.act_url, row.act_title) for row in rows]
    print(f"{len(work)} Act(s) to fetch from Laws.Africa", flush=True)
    fetched = []
    async with httpx.AsyncClient(timeout=90, follow_redirects=True) as client:
        for bill_id, url, title in work:
            try:
                text = await act_trace_service.fetch_act_text(url, client)
            except Exception as exc:
                print(f"  FAILED {title}: {exc}", flush=True)
                continue
            if not text:
                print(f"  {title}: no text returned", flush=True)
                continue
            row = await act_trace_service.get_trace(db, bill_id)
            row.act_text, row.items, row.checked_at, row.model = text, [], None, None
            await db.commit()
            fetched.append(bill_id)
            print(f"  {title}: {len(text):,} characters", flush=True)
            await asyncio.sleep(0.5)
    return fetched


async def from_parliament(db) -> list:
    """Load Act PDFs from Parliament's Acts page for assented bills that have no Act text yet."""
    async with httpx.AsyncClient(timeout=120, follow_redirects=True, headers=HEADERS) as client:
        acts = []
        for session in ("2022", "All"):
            response = await client.get(act_trace_service.PARLIAMENT_ACTS_PAGE, params={"field_parliament_value": session})
            acts += act_trace_service.parse_parliament_acts(response.text)
        acts = list({act["url"]: act for act in acts}.values())
        print(f"{len(acts)} recent Act PDF(s) on Parliament's Acts page", flush=True)
        bills = [bill for bill in await assented_bills(db) if (bill.stage or "").strip().casefold() == "assented"]
        loaded = []
        for act in acts:
            matches = [bill for bill in bills if act_trace_service.match_act(bill.title, bill.bill_year, [{**act, "citation": None}])]
            if len(matches) != 1:
                print(f"  {act['title']}: {'no' if not matches else 'more than one'} matching assented bill", flush=True)
                continue
            bill = matches[0]
            row = await act_trace_service.get_trace(db, bill.id)
            if row is not None and row.act_text:
                print(f"  {act['title']}: already loaded", flush=True)
                continue
            response = await client.get(act["url"])
            if response.status_code != 200 or not response.content.startswith(b"%PDF"):
                print(f"  {act['title']}: download failed (HTTP {response.status_code})", flush=True)
                continue
            path = Path(storage_service.STORAGE_DIR) / "incoming.pdf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(response.content)
            text = await asyncio.to_thread(pdf_text, path)
            named = path.with_name(re.sub(r"[^A-Za-z0-9]+", "_", act["title"]) + ".pdf")
            path.replace(named)
            await load(db, bill, named, text)
            named.unlink(missing_ok=True)
            loaded.append(bill.id)
            print(f"  {act['title']} → {bill.title}: {len(text):,} characters", flush=True)
    return loaded


async def list_links(db) -> None:
    rows = (await db.execute(select(ActTrace, LegislativeItem).join(LegislativeItem, LegislativeItem.id == ActTrace.bill_ref)
                             .where(ActTrace.act_url.is_not(None)).order_by(LegislativeItem.title))).all()
    for row, bill in rows:
        print(f"{'TEXT  ' if row.act_text else '      '}{row.act_citation:<20} {bill.title}\n      {row.act_url}")


async def run(args: argparse.Namespace) -> None:
    async with async_session() as db:
        if args.find:
            await find(db)
        if args.list:
            await list_links(db)
        work: list = []
        if args.fetch:
            work += await fetch(db)
        if args.parliament:
            work += await from_parliament(db)
        if args.dir or args.file:
            if not llm_matching_service.is_configured():
                raise SystemExit("GEMINI_API_KEY is not set.")
            bills = await assented_bills(db)
            traces = {row.bill_ref: row for row in (await db.execute(select(ActTrace))).scalars().all()}
            if args.file:
                if not args.bill or len(args.bill) != len(args.file):
                    raise SystemExit("Give one --bill for each --file.")
                pairs = []
                for identifier, file in zip(args.bill, args.file):
                    bill = next((b for b in bills if b.identifier == identifier), None)
                    if bill is None:
                        raise SystemExit(f"No bill {identifier}")
                    pairs.append((bill, Path(file)))
            else:
                pairs = []
                for path in sorted(Path(args.dir).glob("*.pdf")):
                    text = await asyncio.to_thread(pdf_text, path)
                    bill = bill_for_text(text, bills, traces)
                    print(f"  {path.name}: {'→ ' + bill.title if bill else 'no matching bill (run --find first, or use --bill/--file)'}", flush=True)
                    if bill:
                        pairs.append((bill, path))
            for bill, path in pairs:
                text = await asyncio.to_thread(pdf_text, path)
                if (bill.stage or "").strip().casefold() != "assented":
                    print(f"  skip {bill.identifier}: not assented", flush=True)
                    continue
                await load(db, bill, path, text)
                work.append(bill.id)
        if args.check:
            if not llm_matching_service.is_configured():
                raise SystemExit("GEMINI_API_KEY is not set.")
            query = select(ActTrace).where(ActTrace.act_text.is_not(None))
            if args.bill and not args.file:
                # --check --bill NA/2024/Bill-046: re-check only these bills
                query = query.join(LegislativeItem, LegislativeItem.id == ActTrace.bill_ref).where(LegislativeItem.identifier.in_(args.bill))
            work += [row.bill_ref for row in (await db.execute(query)).scalars().all()]
        for bill_id in dict.fromkeys(work):
            try:
                print("  " + await check(db, bill_id), flush=True)
            except Exception as exc:  # keep going; one bad Act should not stop the run
                await db.rollback()
                print(f"  FAILED {bill_id}: {exc}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--find", action="store_true", help="link assented bills to their Act on Kenya Law")
    parser.add_argument("--dir", help="folder of Act PDFs downloaded from Kenya Law")
    parser.add_argument("--bill", action="append", help="bill identifier for --file (repeatable)")
    parser.add_argument("--file", action="append", help="Act PDF for the matching --bill (repeatable)")
    parser.add_argument("--check", action="store_true", help="re-check every stored Act")
    parser.add_argument("--fetch", action="store_true", help="fetch Act texts from the Laws.Africa API (LAWS_AFRICA_TOKEN)")
    parser.add_argument("--list", action="store_true", help="print each linked Act's Kenya Law address")
    parser.add_argument("--parliament", action="store_true", help="download Acts published on Parliament's Acts page")
    asyncio.run(run(parser.parse_args()))
