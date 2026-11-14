"""Get Act texts onto the platform, locally and in production.

Usage (inside the backend container):

    python -m app.scripts.act_library county
        Load the county Act PDFs saved by download_county_acts (and any added by hand) from
        /app/var/acts/county/<county>/, using each folder's manifest.json. Each Act is stored on
        the bill that became it, with the assembly's own free link to the PDF.

    python -m app.scripts.act_library missing
        List the assented bills whose Act text is not on the platform, and where to get each one.
        Kenya Law blocks automated downloads, so its Acts are listed for you to download in a browser
        and load with `trace_acts --dir`. Try `trace_acts --parliament` first: Parliament's own copies are free.

To copy the Acts to production together with the rest of the trace (reports, analyses, House decisions),
use app.scripts.trace_bundle.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import select, text

from app.database import async_session
from app.models import ActTrace, LegislativeItem
from app.services import act_trace_service, storage_service
from app.scripts.trace_acts import pdf_text

COUNTY_DIR = Path("/app/var/acts/county")
MIN_TEXT = 500


async def bill_for_act(db, house: str, entry: dict) -> LegislativeItem | None:
    """The county bill an Act belongs to: named in the manifest, or the one bill that lists the Act's address."""
    if entry.get("bill"):
        return (await db.execute(select(LegislativeItem).where(LegislativeItem.identifier == entry["bill"]))).scalar_one_or_none()
    ids = (await db.execute(text(
        "SELECT id FROM legislative_items WHERE bill_house=:house AND EXISTS "
        "(SELECT 1 FROM jsonb_array_elements(documents::jsonb) d WHERE d->>'url' = :url)"),
        {"house": house, "url": entry["url"]})).scalars().all()
    return await db.get(LegislativeItem, ids[0]) if len(ids) == 1 else None


async def load_county(base: Path = COUNTY_DIR) -> dict:
    counts = {"loaded": 0, "already": 0, "no_bill": 0, "unreadable": 0, "missing_file": 0}
    async with async_session() as db:
        for folder in sorted(p for p in base.iterdir() if p.is_dir()) if base.is_dir() else []:
            manifest = folder / "manifest.json"
            if not manifest.is_file():
                print(f"{folder.name}: no manifest.json, skipped", flush=True)
                continue
            for entry in json.loads(manifest.read_text()):
                path = folder / entry["file"]
                if not path.is_file():
                    counts["missing_file"] += 1
                    continue
                bill = await bill_for_act(db, folder.name, entry)
                if bill is None:
                    counts["no_bill"] += 1
                    print(f"  no single bill for {entry['title']}", flush=True)
                    continue
                row = await act_trace_service.get_trace(db, bill.id)
                stored = storage_service.persist_report(path.read_bytes(), path.name)
                if row is not None and row.act_text and row.sha256 == stored["sha256"]:
                    counts["already"] += 1
                    continue
                body = await asyncio.to_thread(pdf_text, Path(stored["storage_ref"]))
                if len(body.strip()) < MIN_TEXT:
                    counts["unreadable"] += 1
                    print(f"  could not read the text of {entry['file']}", flush=True)
                    continue
                if row is None:
                    row = ActTrace(bill_ref=bill.id, items=[])
                    db.add(row)
                row.storage_ref, row.sha256, row.act_text = stored["storage_ref"], stored["sha256"], body
                row.act_title, row.act_url = entry["title"][:500], entry["url"]
                row.items, row.checked_at, row.model = [], None, None
                await db.commit()
                counts["loaded"] += 1
                print(f"  {entry['title']} -> {bill.identifier}: {len(body):,} characters", flush=True)
    print(f"County Acts: {counts}", flush=True)
    return counts


async def missing() -> list[dict]:
    async with async_session() as db:
        rows = (await db.execute(
            select(LegislativeItem, ActTrace).outerjoin(ActTrace, ActTrace.bill_ref == LegislativeItem.id)
            .where(LegislativeItem.is_simulated.is_(False), text("lower(legislative_items.stage) = 'assented'"))
            .order_by(LegislativeItem.bill_house, LegislativeItem.title))).all()
    gaps = [{"identifier": bill.identifier, "title": bill.title, "act_url": trace.act_url if trace else None}
            for bill, trace in rows if not (trace and trace.act_text)]
    linked = [g for g in gaps if g["act_url"]]
    print(f"{len(rows)} assented bills; {len(gaps)} without the Act's text, {len(linked)} of them with a known Act address", flush=True)
    for gap in gaps:
        print(f"  {gap['identifier']:<28} {gap['title'][:70]}\n      {gap['act_url'] or '(Act not found yet: run trace_acts --find)'}", flush=True)
    return gaps


async def run(args: argparse.Namespace) -> None:
    if args.command == "county":
        await load_county(Path(args.dir))
    else:
        await missing()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["county", "missing"])
    parser.add_argument("--dir", default=str(COUNTY_DIR), help="county: folder with one subfolder per county")
    asyncio.run(run(parser.parse_args()))
