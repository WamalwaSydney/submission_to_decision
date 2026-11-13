"""When citizens can make submissions on a bill.

This follows National Assembly practice under Article 118 of the Constitution
and Standing Order 127:

* A bill is published in the Kenya Gazette, then read a First Time and
  committed to a departmental committee.
* That committee runs public participation, normally by advertising a call for
  memoranda with a closing date, and reports to the House before the Second
  Reading.
* Once the Second Reading starts, the committee has reported and the House is
  deciding. No new public submissions are taken (Committee of the Whole House,
  Third Reading, passage, assent).

So a bill takes submissions only at the "Public participation" stage. The
sync (and a clerk recording a call for views) puts a bill at that stage while
its committee's call for memoranda is open, and moves it on once the call
closes. A published call (a notice record) is authoritative: its window
decides. A bill at First Reading has been sent to its committee but waits for
the committee's call for memoranda.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

# Stages where the committee is receiving views.
PUBLIC_PARTICIPATION = "Public participation"
PUBLIC_PARTICIPATION_CLOSED = "Public participation closed"
AWAITING_PUBLIC_PARTICIPATION = "Awaiting public participation"

OPEN_STAGES = {PUBLIC_PARTICIPATION.casefold()}

# Stages before public participation begins.
NOT_YET_OPEN_STAGES = {
    "legislative proposal": "This is a legislative proposal still being drafted. Public participation starts after it is published as a bill and read a First Time.",
    "published": "The bill has been published in the Kenya Gazette but not yet read a First Time. Public participation opens once it is committed to a committee.",
    "awaiting first reading": "The bill is awaiting its First Reading. Public participation opens once it is committed to a committee.",
    "first reading": "The bill has been read a First Time and sent to its committee. Submissions open when the committee publishes its call for memoranda.",
    "published by the assembly": "The county assembly has published this bill but does not publish its stage online. Submissions open when the assembly's Clerk's Office records a call for views on this platform.",
    "introduced": "The committee has added this bill. Submissions open when it records its call for views.",
    "awaiting public participation": "The committee has published a call for memoranda that has not opened yet.",
    "referred to national assembly": "The Senate has sent this bill to the National Assembly. Public participation opens after its First Reading in the National Assembly.",
}

# Stages after public participation has ended, with the reason shown to citizens.
CLOSED_STAGES = {
    "public participation closed": "The committee's call for memoranda has closed and it is preparing its report. Submissions are closed.",
    "assented": "This bill has been assented to and is now law. Submissions are closed.",
    "withdrawn": "This bill was withdrawn. Submissions are closed.",
    "lapsed": "This bill lapsed. Submissions are closed.",
    "defeated": "This bill was defeated in the House. Submissions are closed.",
    "defeated at second reading": "This bill was defeated at the Second Reading. Submissions are closed.",
    "consideration stayed": "Consideration of this bill has been stayed. Submissions are closed.",
    "awaiting second reading": "The committee has completed public participation and the bill is awaiting its Second Reading. Submissions are closed.",
    "second reading": "The bill is at the Second Reading, after the committee's public participation. Submissions are closed.",
    "committee stage": "The bill is in the Committee of the Whole House, after public participation. Submissions are closed.",
    "committee of the whole": "The bill is in the Committee of the Whole House, after public participation. Submissions are closed.",
    "awaiting division — committee of the whole": "The bill is in the Committee of the Whole House, after public participation. Submissions are closed.",
    "third reading": "The bill has been read a Third Time. Submissions are closed.",
    "passed by national assembly": "The National Assembly has passed this bill. Submissions are closed.",
    "passed by senate": "Parliament has passed this bill. Submissions are closed.",
    "referred to senate": "The bill is now before the Senate. Follow the Senate's call for memoranda to give views there.",
    "senate amendments returned": "The bill is considering Senate amendments, after public participation. Submissions are closed.",
    "mediation committee": "The bill is before a Mediation Committee, after public participation. Submissions are closed.",
    "mediation report adopted": "The bill's mediated version has been approved. Submissions are closed.",
}


def _notice_dates(notice) -> tuple[Optional[date], Optional[date]]:
    if isinstance(notice, dict):
        start, end = notice.get("window_start"), notice.get("window_end")
    else:
        start, end = getattr(notice, "window_start", None), getattr(notice, "window_end", None)
    if isinstance(start, str):
        start = date.fromisoformat(start[:10])
    if isinstance(end, str):
        end = date.fromisoformat(end[:10])
    return start, end


def participation_window(stage: Optional[str], notices: Iterable = (), today: Optional[date] = None) -> dict:
    """Return whether a bill is accepting citizen submissions, and why."""
    today = today or date.today()
    key = (stage or "").strip().casefold()

    if key in CLOSED_STAGES:
        return {"status": "closed", "accepting": False, "reason": CLOSED_STAGES[key], "opens_on": None, "closes_on": None}

    windows = [window for window in (_notice_dates(notice) for notice in notices) if window[0] and window[1]]
    if windows:
        active = [window for window in windows if window[0] <= today <= window[1]]
        if active:
            closes_on = max(end for _, end in active)
            return {
                "status": "open", "accepting": True,
                "reason": f"The committee's call for memoranda is open until {closes_on.strftime('%d %B %Y')}.",
                "opens_on": min(start for start, _ in active).isoformat(), "closes_on": closes_on.isoformat(),
            }
        upcoming = sorted(start for start, _ in windows if start > today)
        if upcoming:
            return {
                "status": "not_yet_open", "accepting": False,
                "reason": f"The committee's call for memoranda opens on {upcoming[0].strftime('%d %B %Y')}.",
                "opens_on": upcoming[0].isoformat(), "closes_on": None,
            }
        closed_on = max(end for _, end in windows)
        return {
            "status": "closed", "accepting": False,
            "reason": f"The committee's call for memoranda closed on {closed_on.strftime('%d %B %Y')}.",
            "opens_on": None, "closes_on": closed_on.isoformat(),
        }

    if key in OPEN_STAGES:
        return {
            "status": "open", "accepting": True,
            "reason": "The bill is with its committee for public participation. No closing date has been published yet, so submit early.",
            "opens_on": None, "closes_on": None,
        }
    if key in NOT_YET_OPEN_STAGES:
        return {"status": "not_yet_open", "accepting": False, "reason": NOT_YET_OPEN_STAGES[key], "opens_on": None, "closes_on": None}
    return {
        "status": "closed", "accepting": False,
        "reason": "This bill is not currently open for public participation.",
        "opens_on": None, "closes_on": None,
    }


def stage_from_notices(stage: Optional[str], notices: Iterable = (), today: Optional[date] = None, source_stage: Optional[str] = None) -> Optional[str]:
    """The stage a bill should be at given its calls for memoranda, or None to leave it.

    * An open call puts the bill at "Public participation" (unless it has already
      moved past it, for example to the Second Reading).
    * A bill at "Public participation" with no open call goes back to its official
      tracker stage, or to "Awaiting public participation" / "Public participation
      closed" when the call has not opened yet or has ended.
    """
    today = today or date.today()
    key = (stage or "").strip().casefold()
    if key in CLOSED_STAGES and key != PUBLIC_PARTICIPATION_CLOSED.casefold():
        return None
    windows = [window for window in (_notice_dates(notice) for notice in notices) if window[0] and window[1]]
    if any(start <= today <= end for start, end in windows):
        return None if key in OPEN_STAGES else PUBLIC_PARTICIPATION
    if key not in OPEN_STAGES and key != AWAITING_PUBLIC_PARTICIPATION.casefold():
        return None
    if any(start > today for start, _ in windows):
        new = AWAITING_PUBLIC_PARTICIPATION
    elif source_stage and source_stage.strip().casefold() not in OPEN_STAGES:
        new = source_stage
    else:
        new = PUBLIC_PARTICIPATION_CLOSED
    return None if new.casefold() == key else new
