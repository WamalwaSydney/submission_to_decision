"""Background processing of committee reports linked from the Parliament sync.

Reading and matching a report PDF (download, OCR, Gemini) is slow and costs
money, so visitors never trigger it. The API runs one worker that picks up a
few pending reports at a time. Row locks inside the extractor stop two API
instances from processing the same report.
"""
from __future__ import annotations

import asyncio
import logging
import os

from sqlalchemy import select

from app.database import async_session
from app.models import CommitteeReport
from app.services import ingestion_service, linking_service

log = logging.getLogger(__name__)

INTERVAL_SECONDS = int(os.getenv("REPORT_WORKER_INTERVAL_SECONDS", "600"))
BILLS_PER_RUN = int(os.getenv("REPORT_WORKER_BILLS_PER_RUN", "3"))


def enabled() -> bool:
    return os.getenv("REPORT_WORKER_ENABLED", "true").lower() not in {"0", "false", "no"}


async def process_pending_reports(limit: int = BILLS_PER_RUN) -> int:
    """Extract and match pending linked reports for up to `limit` bills."""
    async with async_session() as db:
        bill_ids = list((await db.execute(
            select(CommitteeReport.bill_ref)
            .where(
                CommitteeReport.extraction_status == "pending",
                CommitteeReport.source_url.is_not(None),
                CommitteeReport.bill_ref.is_not(None),
            )
            .distinct()
            .limit(limit)
        )).scalars().all())
    for bill_id in bill_ids:
        try:
            async with async_session() as db:
                await ingestion_service.extract_pending_linked_reports(db, bill_id)
                await linking_service.propose_matches(db, bill_id, use_llm=True)
        except Exception:
            log.exception("Report processing failed for bill %s", bill_id)
    return len(bill_ids)


async def run_forever() -> None:
    await asyncio.sleep(60)  # let the API finish starting first
    while True:
        try:
            processed = await process_pending_reports()
            if processed:
                log.info("Processed pending committee reports for %d bills", processed)
        except Exception:
            log.exception("Committee report worker run failed")
        await asyncio.sleep(INTERVAL_SECONDS)
