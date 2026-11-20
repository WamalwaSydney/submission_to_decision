"""Repair committee reports: merge duplicates of the same PDF, and retry reports that could not be read.

    python -m app.scripts.repair_reports duplicates            # dry run: what would change
    python -m app.scripts.repair_reports duplicates --apply
    python -m app.scripts.repair_reports retry-unread --apply

duplicates
    The sync once stored the same report PDF twice for one bill when two committee pages linked it (for example
    ".../committees/12/..." and ".../index.php/.../committees/12/..."). For each such pair the copy that carries the
    most (sealed records, AI reading, confirmed or proposed matches, entries, text) is kept. Each other copy is:
      * deleted, with its entries, after moving any matches onto the kept copy's identical entries; or
      * hidden, when it has records in the hash chain or its own AI reading. Hash-chain records are append-only and
        cannot be deleted, so the copy stays in the database, out of every public list and count, with its committee
        link marked "#duplicate-of-<kept id>".
    Every change is written to the audit log.

retry-unread
    Reports flagged needs_review with no text at all could not be read (for example, a file over the old 35 MB limit).
    Put them back in the queue so the report worker reads them again.
"""
import argparse
import asyncio
from collections import defaultdict

from sqlalchemy import text

from app.database import async_session

GOOD_STATUS = {"verified": 3, "extracted": 2, "ocr_used": 2, "needs_review": 1}

GROUPS_SQL = """
SELECT r.id, r.source_url, r.bill_ref, r.extraction_status,
       length(coalesce(r.extracted_text, '')) > 0 AS has_text,
       (SELECT count(*) FROM report_entries e WHERE e.report_ref = r.id) AS entries,
       EXISTS (SELECT 1 FROM report_analyses a WHERE a.report_ref = r.id) AS analysed,
       (SELECT count(*) FROM submission_matches m JOIN report_entries e ON e.id = m.report_entry_ref WHERE e.report_ref = r.id) AS matches,
       (SELECT count(*) FROM report_records x WHERE x.report_ref = r.id) AS records
FROM committee_reports r
WHERE r.is_simulated = false AND r.source_url IS NOT NULL AND r.bill_ref IS NOT NULL
  AND (r.source_url, r.bill_ref) IN (
      SELECT source_url, bill_ref FROM committee_reports
      WHERE is_simulated = false AND source_url IS NOT NULL AND bill_ref IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) > 1)
ORDER BY r.source_url, r.bill_ref, r.id
"""


async def _move_matches(db, loser, keeper) -> bool:
    """Point the loser's matches at the kept copy's identical entries. False if any has no identical entry."""
    moves = (await db.execute(text("""
        SELECT m.id AS match_id, k.id AS keeper_entry
        FROM submission_matches m
        JOIN report_entries e ON e.id = m.report_entry_ref AND e.report_ref = :loser
        LEFT JOIN LATERAL (
            SELECT k.id FROM report_entries k
            WHERE k.report_ref = :keeper AND k.clause_ref IS NOT DISTINCT FROM e.clause_ref
              AND k.extracted_summary = e.extracted_summary
            ORDER BY k.id LIMIT 1) k ON true"""), {"loser": loser, "keeper": keeper})).all()
    if any(row.keeper_entry is None for row in moves):
        return False
    for row in moves:
        await db.execute(text("UPDATE submission_matches SET report_entry_ref = :entry WHERE id = :id"),
                         {"entry": row.keeper_entry, "id": row.match_id})
    return True


async def _audit(db, report_id, action: str, details: str) -> None:
    await db.execute(text("INSERT INTO audit_log (id, entity_type, entity_id, action, details, timestamp) "
                          "VALUES (gen_random_uuid(), 'committee_report', :id, :action, :details, now())"),
                     {"id": report_id, "action": action, "details": details})


async def duplicates(apply: bool) -> dict:
    counts = defaultdict(int)
    async with async_session() as db:
        rows = (await db.execute(text(GROUPS_SQL))).all()
    groups: dict = defaultdict(list)
    for row in rows:
        groups[(row.source_url, row.bill_ref)].append(row)
    print(f"{len(groups)} PDF(s) stored more than once for the same bill ({len(rows)} rows)", flush=True)
    for (source_url, _), members in groups.items():
        # Keep the copy that carries the most; ties go to the lowest id, so every run picks the same one.
        keeper = max(members, key=lambda r: (r.records > 0, r.analysed, r.matches > 0, r.entries, r.has_text,
                                             GOOD_STATUS.get(r.extraction_status, 0), -int(str(r.id).replace("-", ""), 16)))
        counts["groups"] += 1
        # One short transaction per group: a distant hosted database drops long-held connections.
        async with async_session() as db:
            for loser in [m for m in members if m.id != keeper.id]:
                hide = loser.records > 0 or loser.analysed
                if not hide and loser.matches and not (await _move_matches(db, loser.id, keeper.id) if apply else True):
                    hide = True  # a match has nowhere identical to go: keep its entries rather than lose it
                name = source_url.rsplit("/", 1)[-1][:90]
                if hide:
                    counts["hidden"] += 1
                    counts["records_on_hidden_copies"] += loser.records
                    print(f"  hide   {loser.id} ({loser.records} records, analysed={loser.analysed}) keep {keeper.id}  {name}", flush=True)
                    if apply:
                        await db.execute(text("UPDATE committee_reports SET is_simulated = true, "
                                              "committee_url = coalesce(committee_url, '') || '#duplicate-of-' || :keeper WHERE id = :id"),
                                         {"keeper": str(keeper.id), "id": loser.id})
                        await _audit(db, loser.id, "hidden_duplicate", f"Same PDF as report {keeper.id} on the same bill; hidden, "
                                     f"not deleted, because its {loser.records} hash-chain record(s) are append-only.")
                else:
                    counts["deleted"] += 1
                    counts["entries_deleted"] += loser.entries
                    counts["matches_moved"] += loser.matches
                    if apply:
                        await db.execute(text("DELETE FROM legislative_link_reviews WHERE report_ref = :id"), {"id": loser.id})
                        await db.execute(text("DELETE FROM report_entries WHERE report_ref = :id"), {"id": loser.id})
                        await db.execute(text("DELETE FROM report_analyses WHERE report_ref = :id"), {"id": loser.id})
                        await db.execute(text("DELETE FROM committee_reports WHERE id = :id"), {"id": loser.id})
                        await _audit(db, keeper.id, "merged_duplicate", f"Deleted duplicate report {loser.id} (same PDF, same bill; "
                                     f"{loser.entries} entries, {loser.matches} matches moved here).")
            if apply:
                await db.commit()
    print(("Applied: " if apply else "Dry run (nothing changed): ") + str(dict(counts)), flush=True)
    return dict(counts)


async def retry_unread(apply: bool) -> int:
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT id, coalesce(title, source_document_ref) AS name FROM committee_reports "
            "WHERE extraction_status = 'needs_review' AND coalesce(extracted_text, '') = '' "
            "AND source_url IS NOT NULL AND bill_ref IS NOT NULL AND is_simulated = false ORDER BY date_tabled DESC"))).all()
        for row in rows:
            print(f"  retry  {row.id}  {str(row.name)[:100]}", flush=True)
        if apply and rows:
            await db.execute(text("UPDATE committee_reports SET extraction_status = 'pending' WHERE id = ANY(:ids)"),
                             {"ids": [row.id for row in rows]})
            for row in rows:
                await _audit(db, row.id, "retry_extraction", "Could not be read before; queued to be read again.")
            await db.commit()
    print(("Queued " if apply else "Dry run: would queue ") + f"{len(rows)} unread report(s) for the report worker.", flush=True)
    return len(rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["duplicates", "retry-unread"])
    parser.add_argument("--apply", action="store_true", help="make the changes (default: only show them)")
    args = parser.parse_args()
    asyncio.run(duplicates(args.apply) if args.command == "duplicates" else retry_unread(args.apply))
