"""Find what the House decided on each committee recommendation (Committee of the Whole House).

Usage (inside the backend container):
    python -m app.scripts.trace_house --passed
        Every passed bill whose committee report has been analysed.
    python -m app.scripts.trace_house --bill NA/2025/Bill-015 --bill NA/2024/Bill-046
    add --refetch to read the Hansard again, --redo to re-check bills already done

The Hansard comes from Mzalendo (mzalendo.com), read politely; the stage dates come
from Parliament's Bills Tracker. Each bill is one or more Gemini calls.
"""
from __future__ import annotations

import argparse
import asyncio

import httpx
from sqlalchemy import func, select

from app.api.routes import PASSED_STAGES
from app.database import async_session
from app.models import HouseTrace, LegislativeItem
from app.services import house_trace_service, llm_matching_service, report_analysis_service
from app.services.act_trace_service import recommendations


async def run(args: argparse.Namespace) -> None:
    if not llm_matching_service.is_configured():
        raise SystemExit("GEMINI_API_KEY is not set.")
    async with async_session() as db:
        query = select(LegislativeItem).where(LegislativeItem.is_simulated.is_(False), LegislativeItem.institution == "National Assembly")
        if args.bill:
            query = query.where(LegislativeItem.identifier.in_(args.bill))
        elif args.passed:
            query = query.where(func.lower(LegislativeItem.stage).in_(PASSED_STAGES))
        else:
            raise SystemExit("Choose --passed or one or more --bill identifiers.")
        bills = (await db.execute(query)).scalars().all()
        done = {row.bill_ref for row in (await db.execute(select(HouseTrace).where(HouseTrace.checked_at.is_not(None)))).scalars().all()}
        work = []
        for bill in bills:
            analyses = await report_analysis_service.analyses_for_bills(db, [bill.id])
            items = (report_analysis_service.combine(analyses.get(bill.id, [])) or {}).get("items", [])
            if recommendations(items) and (args.redo or args.refetch or bill.id not in done):
                work.append((bill.id, items))
        print(f"{len(work)} bill(s) to trace through the House", flush=True)
        async with httpx.AsyncClient(timeout=90, follow_redirects=True, headers=house_trace_service.HEADERS) as client:
            for bill_id, items in work:
                bill = await db.get(LegislativeItem, bill_id)
                title = bill.title
                try:
                    row = await house_trace_service.run(db, bill, items, client, refetch=args.refetch)
                    found, item_count = len(row.sittings or []), len(row.items or [])
                    c = house_trace_service.counts(row.items or [])
                    await db.commit()
                except Exception as exc:  # keep going; one bill should not stop the run
                    await db.rollback()
                    print(f"  FAILED {title}: {exc}", flush=True)
                    continue
                if not found:
                    print(f"  {title}: no Committee of the Whole House sitting found", flush=True)
                else:
                    print(f"  {title}: {found} sitting(s); of {item_count} adopted recommendations, {c['agreed']} agreed, "
                          f"{c['negatived']} negatived, {c['withdrawn']} withdrawn, {c['not_found']} not found, {c['unclear']} unclear", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--passed", action="store_true")
    parser.add_argument("--bill", action="append")
    parser.add_argument("--refetch", action="store_true", help="read the Hansard again")
    parser.add_argument("--redo", action="store_true", help="re-check bills already traced")
    asyncio.run(run(parser.parse_args()))
