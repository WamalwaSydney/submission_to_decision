"""Fill gaps the regular sync leaves: reports without a bill, and bills without their text.

Usage (inside the backend container):
    python -m app.scripts.fill_gaps              # link reports, add bill texts, extract the newly linked reports
    python -m app.scripts.fill_gaps --no-extract # skip downloading and reading report PDFs

1. Links committee reports to their bill by the official reference or the bill's exact name and year
   (see sync_legislation.resolve_report_bill). Near matches are left for a person.
2. Adds bill texts from Mzalendo's bill tracker for bills Parliament's Bills pages do not list.
3. Downloads and reads each newly linked report so its submissions can be analysed
   (then run analyse_reports, trace_house and trace_acts).
"""
from __future__ import annotations

import argparse
import asyncio
import os

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import async_session
from app.models import CommitteeReport
from app.scripts import sync_legislation as sync
from app.services import ingestion_service


async def link_and_attach() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            print(f"Reports linked to their bill: {await sync.link_unlinked_reports(conn)}", flush=True)
        async with engine.begin() as conn:
            skip = await sync.titles_with_text(conn)
        texts = await sync.fetch_mzalendo_bill_texts(skip)
        async with engine.begin() as conn:
            print(f"Bill texts from Mzalendo: {len(texts)} found, {await sync.attach_bill_texts(conn, texts)} newly linked", flush=True)
    finally:
        await engine.dispose()


async def extract(part: int = 0, parts: int = 1) -> None:
    async with async_session() as db:
        bills = (await db.execute(select(CommitteeReport.bill_ref).where(
            CommitteeReport.bill_ref.is_not(None), CommitteeReport.extraction_status == "pending").distinct())).scalars().all()
        # --part i/n: several processes can read reports at once, each taking every n-th bill.
        bills = sorted(bills, key=str)[part::parts]
        print(f"Reading reports for {len(bills)} bill(s)", flush=True)
        for i, bill_id in enumerate(bills, 1):
            try:
                count = await ingestion_service.extract_pending_linked_reports(db, bill_ref=bill_id)
            except Exception as exc:  # one bad PDF must not stop the rest
                await db.rollback()
                print(f"  {i}/{len(bills)} FAILED: {exc}", flush=True)
                continue
            print(f"  {i}/{len(bills)} read {count} report(s)", flush=True)
        rows = (await db.execute(text(
            "SELECT extraction_status, count(*) FROM committee_reports WHERE bill_ref IS NOT NULL GROUP BY 1"))).all()
        print("Linked reports by status:", dict(rows), flush=True)


async def run(args: argparse.Namespace) -> None:
    if args.part:
        part, parts = (int(x) for x in args.part.split("/"))
        await extract(part, parts)
        return
    await link_and_attach()
    if not args.no_extract:
        await extract()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-extract", action="store_true")
    parser.add_argument("--part", help="only read reports, for every n-th bill: 0/4, 1/4, ... run in parallel")
    asyncio.run(run(parser.parse_args()))
