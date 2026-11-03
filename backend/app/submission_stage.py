"""Where a citizen's submission is, from the moment it is sent to the outcome.

Mirrors src/utils/submissionStage.ts:

received → with_committee → report_published → under_review → outcome
(adopted, amended, rejected, not_addressed).

A moderator rejecting a proposed match means the committee report does not
respond to the submission, so that is "not_addressed", not a committee rejection.
"""
from __future__ import annotations

STAGES = ("received", "with_committee", "report_published", "under_review", "adopted", "amended", "rejected", "not_addressed")


def treatment_stage(treatment: str | None) -> str:
    if treatment == "amended":
        return "amended"
    if treatment == "rejected with reasons":
        return "rejected"
    if treatment == "not addressed":
        return "not_addressed"
    # A confirmed match is adopted unless the report records something else.
    return "adopted"


def submission_stage(matches, entries_by_id: dict, report_published: bool, accepting_views: bool) -> str:
    confirmed = next((m for m in matches if m.reviewer_decision == "confirmed"), None)
    if confirmed:
        entry = entries_by_id.get(confirmed.report_entry_ref)
        return treatment_stage(entry.treatment if entry else None)
    if any(m.reviewer_decision == "pending" for m in matches):
        return "under_review"
    if any(m.reviewer_decision == "rejected" for m in matches):
        return "not_addressed"
    if report_published:
        return "report_published"
    return "received" if accepting_views else "with_committee"
