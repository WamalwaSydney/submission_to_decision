"""Seal the submissions committee reports record into the hash chain (report records, REC-XXXXXX).

    python -m app.scripts.seal_report_records

Safe to run any time: a submission is sealed once, and records already in the chain are never changed.
The report worker inside the API, analyse_reports and trace_bundle import run this too.
"""
import asyncio

from app.database import async_session
from app.services import report_record_service


async def main() -> None:
    async with async_session() as db:
        added = await report_record_service.seal_new_records(db)
    print(f"Sealed {added} report record(s) into the hash chain.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
