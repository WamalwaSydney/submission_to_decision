"""Ask Gemini to read committee reports and record what happened to public submissions.

Usage (inside the backend container):
    python -m app.scripts.analyse_reports --passed            # bills that have passed or become law
    python -m app.scripts.analyse_reports --bill NA/2025/Bill-015 --bill SENATE/2023/Bill-010
    python -m app.scripts.analyse_reports --all --limit 20    # any bill with a report
    add --redo to re-run reports that already have an analysis

Each report is one or more paid Gemini calls (20 entries per call), so start small.
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import func, select

from app.api.routes import PASSED_STAGES
from app.database import async_session
from app.models import CommitteeReport, LegislativeItem, ReportAnalysis, ReportEntry
from app.services import llm_matching_service, report_analysis_service


async def run(args: argparse.Namespace) -> None:
    if not llm_matching_service.is_configured():
        raise SystemExit("GEMINI_API_KEY is not set.")
    async with async_session() as db:
        query = (select(CommitteeReport, LegislativeItem)
                 .join(LegislativeItem, LegislativeItem.id == CommitteeReport.bill_ref)
                 .where(CommitteeReport.is_simulated.is_(False), LegislativeItem.is_simulated.is_(False)))
        if args.bill:
            query = query.where(LegislativeItem.identifier.in_(args.bill))
        elif args.passed:
            query = query.where(func.lower(LegislativeItem.stage).in_(PASSED_STAGES))
        elif not args.all:
            raise SystemExit("Choose --passed, --all or one or more --bill identifiers.")
        done = set((await db.execute(select(ReportAnalysis.report_ref))).scalars().all())
        rows = [(report, bill) for report, bill in (await db.execute(query)).all() if args.redo or report.id not in done]
        entry_counts = dict((await db.execute(select(ReportEntry.report_ref, func.count()).group_by(ReportEntry.report_ref))).all())
        rows = [(report, bill) for report, bill in rows if entry_counts.get(report.id)]
        rows = rows[: args.limit] if args.limit else rows
        # Plain values: a commit expires ORM objects, and async sessions cannot reload them implicitly.
        work = [(report.id, bill.identifier, bill.title) for report, bill in rows]
        print(f"{len(work)} report(s) to analyse with {llm_matching_service.MODEL}", flush=True)
        for report_id, identifier, title in work:
            try:
                report = await db.get(CommitteeReport, report_id)
                analysis = await report_analysis_service.analyse_report(db, report, title)
                found, entries = len(analysis.items), analysis.entries_analysed
                counts = report_analysis_service.decision_counts(analysis.items)
                await db.commit()
            except Exception as exc:  # keep going; one bad report should not stop the run
                await db.rollback()
                print(f"  FAILED {identifier}: {exc}", flush=True)
                continue
            print(f"  {identifier}: {found} submissions in {entries} entries · {counts}", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bill", action="append", help="bill identifier, e.g. NA/2025/Bill-015 (repeatable)")
    parser.add_argument("--passed", action="store_true", help="bills that have passed or are now law")
    parser.add_argument("--all", action="store_true", help="every bill with a committee report")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--redo", action="store_true", help="re-run reports that already have an analysis")
    asyncio.run(run(parser.parse_args()))
