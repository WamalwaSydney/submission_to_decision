"""Sync Kenya Parliament legislation into Participation Trace.

Run from ``backend/``::

    python -m app.scripts.sync_legislation

The Parliament's legislative-proposals page publishes tracker PDFs rather than
HTML rows. This sync discovers the newest proposal tracker and National Assembly
Bills Tracker, extracts their fixed-width text with ``pdftotext``, and applies
authoritative bill stages to existing ``legislative_items`` rows by exact
house/number/year matches. It also discovers the live Submission of Memoranda
page from the committee navigation, parses each notice, and upserts notices.

Committee report ingestion keeps the report PDF URL as the verifiable endpoint.
A report is linked to a bill automatically only when the normalized
(house, number, year) key agrees.  A title-only/numberless report is never
silently attached: candidates are written to ``legislative_link_reviews`` for
human confirmation.

Note on ids: every raw ``INSERT`` below supplies ``id`` explicitly
(``uuid.uuid4()``).  The models use ``default=uuid.uuid4`` which is applied by
the ORM only, so raw SQL must generate the id itself.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from rapidfuzz.fuzz import partial_ratio, ratio
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sync_legislation")

BASE = "https://www.parliament.go.ke"
COMMITTEES_INDEX = f"{BASE}/the-national-assembly/committees"
TRACKER_INDEX = f"{BASE}/legislative-proposals-tracker"
BILL_TRACKER_INDEX = f"{BASE}/the-national-assembly/house-business/bill-tracker"
MEMORANDA_INDEX = f"{BASE}/submission-memoranda"
# Parliament's "Submission of Memoranda" listings are stale (2019–2020 treaty
# adverts). Current calls for memoranda are standalone pages, found through the
# site search and the House landing pages.
NOTICE_SEARCH_QUERIES = ("invitation to submit memoranda", "public hearings memoranda", "submission of memoranda")
NOTICE_SEARCH_PAGES = 4
NOTICE_SEED_PAGES = (f"{BASE}/", f"{BASE}/the-national-assembly", f"{BASE}/the-senate")
NOTICE_SLUG_RE = re.compile(r"memorand|public-hearing", re.I)
STALE_NOTICE_PATHS = ("/submission-memoranda", "/submission-memoranda-0")
HEADERS = {"User-Agent": "UraiaLegislationSync/1.0 (civic-tech research; non-commercial)"}
CONCURRENCY = 4
POLITE_DELAY_S = 0.35
MIN_COMMITTEES = 20
MAX_FAILED_FRACTION = 0.25
PDF_RE = re.compile(r"\.pdf(?:$|[?#])", re.I)
MONTH_RE = re.compile(r"/sites/default/files/(\d{4})-(\d{2})/")
COMMITTEE_KEY_ALIASES = {
    "budget and appropriation": "budget and appropriation",
    "administration and national security": "administration and internal security",
    "blue economy and irrigation": "blue economy water and irrigation",
    "transport and housing": "transport and infrastructure",
}
BILL_REF_RE = re.compile(
    r"\b(?P<house>national\s+assembly|na|senate)\s*bills?\s*(?:no\.?\s*)?(?P<number>\d+)\s*(?:of\s+)?(?:[A-Za-z]+\s+){0,3}(?P<year>20\d{2})\b",
    re.I,
)
GENERIC_BILL_REF_RE = re.compile(r"\bbill\s*(?:no\.?\s*)?(\d+)\s*(?:of\s+)?(?:[A-Za-z]+\s+){0,3}(20\d{2})\b", re.I)
TRACKER_BILL_HEAD_RE = re.compile(r"\b(?P<house>national\s+assembly|na|senate)\s*bill\s*(?:no\.?\s*)?(?P<number>\d+)\b", re.I)
# The official Bills Tracker writes references as "NA. Bill No. 8 of 2024" and
# "Sen. Bill No. 4 of 2022"; the house abbreviation may carry a full stop.
BILL_TRACKER_REF_RE = re.compile(r"\b(?P<house>national\s+assembly|na|senate|sen)\.?\s+bills?\s+no\.?\s*(?P<number>\d+)\s+of\s+(?P<year>20\d{2})\b", re.I)
YEAR_RE = re.compile(r"\b(20\d{2})\b")
DATE_RE = re.compile(
    r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+"
    r"(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(20\d{2})\b",
    re.I,
)
NUMERIC_DATE_RE = re.compile(r"\b\d{1,2}\s*/\s*\d{1,2}\s*/\s*20\d{2}\b")

# File references look like DLS/NA/2023/123 -- no spaces.  The old pattern
# allowed spaces around slashes and matched fragments such as "DLS/NA/ The".
FILE_REF_RE = re.compile(r"\b(?:NA/)?DLS/[A-Za-z0-9.()-]+(?:/[A-Za-z0-9.()-]+)+")

# Whitelisted stage labels, most advanced first.  Anything else falls back to
# DEFAULT_STAGE instead of storing raw table text.
DEFAULT_STAGE = "Legislative proposal"
STAGE_PATTERNS = (
    ("Assented", re.compile(r"\bassent(?:ed)?\b", re.I)),
    ("Third Reading", re.compile(r"\bthird\s+reading\b", re.I)),
    ("Committee of the Whole", re.compile(r"\bcommittee\s+of\s+the\s+whole\b", re.I)),
    ("Second Reading", re.compile(r"\bsecond\s+reading\b", re.I)),
    ("First Reading", re.compile(r"\bfirst\s+reading\b", re.I)),
    ("Withdrawn", re.compile(r"\bwithdrawn\b", re.I)),
    ("Lapsed", re.compile(r"\blapsed\b", re.I)),
    ("Published", re.compile(r"\bpublished\b", re.I)),
)

# Column limits from models.LegislativeItem
BILL_LIMITS = {
    "title": 500,
    "identifier": 100,
    "stage": 100,
    "source_url": 1000,
    "source_file_ref": 255,
}

MONTHS = {m.lower(): i for i, m in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}


def clean(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("’", "'")
    return re.sub(r"\s+", " ", value).strip(" .;,:\u2013\u2014")


def canonical_title(value: str) -> str:
    value = clean(value).lower()
    value = re.sub(r"\b(the|bill|of|national|assembly|senate|no)\b", " ", value)
    value = re.sub(r"\b20\d{2}\b", " ", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def canonical_house(value: str | None) -> str | None:
    if not value:
        return None
    value = value.lower().strip(" .")
    if "senate" in value or value == "sen":
        return "senate"
    if value in {"na", "national assembly"} or "national assembly" in value:
        return "na"
    return None


def extract_stage(joined_row: str) -> str:
    """Map a raw tracker row to a known stage label (never raw table text)."""
    for label, pattern in STAGE_PATTERNS:
        if pattern.search(joined_row):
            return label
    return DEFAULT_STAGE


CURRENT_BILL_STAGE_PATTERNS = (
    ("Assented", re.compile(r"\bbill\s+(?:has\s+been\s+)?assented\s+to\b", re.I)),
    ("Withdrawn", re.compile(r"\bbill\s+(?:was\s+)?withdrawn\b|\bwithdrawn\s+by\s+the\s+mover\b", re.I)),
    ("Defeated at Second Reading", re.compile(r"\bbill\s+(?:was\s+)?(?:defeated|rejected)\s+at\s+the\s+second\s+reading\s+stage\b|\bbill\s+(?:was\s+)?lost\s+at\s+(?:the\s+)?(?:2nd|second)\s+reading\b", re.I)),
    ("Defeated", re.compile(r"\bbill\s+(?:was\s+)?defeated\b|\bbill\s+(?:was\s+)?rejected(?:\s+by\b|\s+at\b)", re.I)),
    ("Consideration Stayed", re.compile(r"\bconsideration\s+of\s+the\s+bill\s+(?:was\s+)?stayed\b", re.I)),
    ("Lapsed", re.compile(r"\bbill\s+(?:has\s+)?lapsed\b", re.I)),
    ("Mediation Committee", re.compile(r"\bbill\s+(?:was\s+)?referred\s+to\s+(?:a\s+)?mediation\s+committee\b", re.I)),
    ("Mediation Report Adopted", re.compile(r"\bmediated\s+version\s+of\s+(?:the\s+)?bill\s+approved\b", re.I)),
    ("Senate Amendments Returned", re.compile(r"\bsenate\s+amendments\s+referred\s+back\b", re.I)),
    ("Committee Stage", re.compile(r"\bcommittee\s+stage\b", re.I)),
    ("Awaiting Division — Committee of the Whole", re.compile(r"\bbill\s+(?:is\s+)?awaiting\s+division\s+at\s+committee\s+of\s+the\s+whole\s+stage\b", re.I)),
    ("Committee of the Whole", re.compile(r"\bbill\s+(?:is\s+)?at\s+committee\s+of\s+the\s+whole\s+stage\b", re.I)),
    ("Second Reading", re.compile(r"\bbill\s+(?:is\s+)?at\s+second\s+reading\s+stage\b", re.I)),
    ("Awaiting Second Reading", re.compile(r"\bbill\s+(?:is\s+)?due\s+for\s+second\s+reading\b|\bbill\s+awaiting\s+second\s+reading\b", re.I)),
    ("First Reading", re.compile(r"\bbill\s+(?:is\s+)?at\s+first\s+reading\s+stage\b", re.I)),
    ("Awaiting First Reading", re.compile(r"\bbill\s+(?:is\s+)?due\s+for\s+first\s+reading\b|\bbill\s+awaiting\s+first\s+reading\b", re.I)),
    ("Referred to National Assembly", re.compile(r"\bbill\b(?:(?!\.).){0,220}\breferred\s+(?:back\s+)?to\s+the\s+national\s+assembly\b|\bforwarded\s+to\s+the\s+national\s+assembly\s+for\s+consideration\b", re.I)),
    ("Referred to Senate", re.compile(r"\bbill\b(?:(?!\.).){0,220}\breferred\s+(?:back\s+)?to\s+the\s+senate\b|\bforwarded\s+to\s+the\s+senate\s+for\s+consideration\b", re.I)),
    ("Passed by National Assembly", re.compile(r"\bbill\s+passed\s+by\s+the\s+national\s+assembly\b", re.I)),
    ("Passed by Senate", re.compile(r"\bbill\s+passed\s+by\s+the\s+senate\b", re.I)),
    # The National Assembly tracker's remarks cell often just says "Passed" or
    # "Passed with amendments on <date>" once the Third Reading vote is taken.
    ("Passed by National Assembly", re.compile(r"(?:^|[.;]\s*)passed\b(?!\s+by\s+the\s+senate)", re.I)),
)


def extract_current_bill_stage(row_text: str) -> str | None:
    """Select the latest explicit stage/outcome statement in an official tracker row."""
    matches = [
        (match.end(), len(match.group(0)), label)
        for label, pattern in CURRENT_BILL_STAGE_PATTERNS
        for match in pattern.finditer(row_text)
    ]
    return max(matches)[2] if matches else None


def parse_bill_tracker_columns(layout_text: str) -> dict[int, dict[str, str]]:
    """Read National Assembly tracker cells from pdftotext's fixed-width layout."""
    rows: dict[int, dict[str, str]] = {}
    offsets: tuple[int, int, int, int, int, int, int, int] | None = None
    # Publication ("DATED") and "MATURITY DATE" columns, when the header has them.
    dated_offsets: tuple[int, int] | None = None
    serial: int | None = None
    columns: dict[str, list[str]] = {}

    def save_row() -> None:
        if serial is not None:
            rows[serial] = {name: clean(" ".join(parts)) for name, parts in columns.items()}

    def append_cells(line: str) -> None:
        if offsets is None or serial is None:
            return
        bill, sponsor, na_sen, first, second, third, remarks, assent = offsets
        columns["title"].append(line[bill:sponsor])
        columns["sponsor"].append(line[sponsor:na_sen])
        if dated_offsets:
            columns["published"].append(line[dated_offsets[0]:dated_offsets[1]])
        columns["first_read"].append(line[first:second])
        columns["second_read"].append(line[second:third])
        columns["third_read"].append(line[third:remarks])
        columns["remarks"].append(line[remarks:assent])
        columns["assent"].append(line[assent:])

    for line in layout_text.splitlines():
        if "REMARKS" in line and "ASSENT" in line:
            bill = line.find("BILL")
            sponsor = line.find("SPONSOR", bill + len("BILL"))
            na_sen = line.find("NA/Sen.", sponsor + len("SPONSOR"))
            first = line.find("1ST READ") - 1
            second = line.find("2ND READ") - 1
            third = line.find("3RD READ") - 1
            remarks = line.find("REMARKS") - 1
            assent = line.find("ASSENT", remarks + len("REMARKS")) - 1
            if min(bill, sponsor, na_sen, first, second, third, remarks, assent) >= 0:
                offsets = (bill, sponsor, na_sen, first, second, third, remarks, assent)
                dated = line.find("DATED", na_sen)
                maturity = line.find("MATURITY", dated)
                dated_offsets = (dated - 2, maturity - 1) if 0 <= dated < maturity < first else None
            continue
        if any(label in line for label in ("Status as at", "THE NATIONAL ASSEMBLY", "BILLS TRACKER", "S/No/ BILL")):
            continue
        match = re.match(r"^\s*(\d+)\.\s+", line)
        if match:
            save_row()
            serial = int(match.group(1))
            columns = {name: [] for name in ("title", "sponsor", "published", "first_read", "second_read", "third_read", "remarks", "assent")}
            append_cells(line)
        elif serial is not None and line.strip():
            append_cells(line)
    save_row()
    return rows


@dataclass(frozen=True)
class BillRow:
    title: str
    identifier: str
    house: str
    number: int | None
    year: int
    stage: str
    source_url: str
    source_file_ref: str | None
    committee_name: str | None = None
    stage_source_url: str | None = None
    stage_as_at: date | None = None
    history: tuple[dict, ...] = ()


@dataclass(frozen=True)
class NoticeRow:
    title: str
    source_url: str
    notice_date: date
    deadline: date
    committee_name: str
    bill_title: str
    bill_house: str
    bill_number: int | None
    bill_year: int
    document_urls: tuple[str, ...]


async def get(client: httpx.AsyncClient, url: str, attempts: int = 3) -> httpx.Response:
    for attempt in range(attempts):
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response
        except (httpx.TransportError, httpx.HTTPStatusError):
            if attempt == attempts - 1:
                raise
            await asyncio.sleep(2**attempt)
    raise RuntimeError("unreachable")


def pdf_links(html: str, page_url: str) -> list[tuple[str, str]]:
    soup = BeautifulSoup(html, "lxml")
    links = []
    for a in soup.select("a[href]"):
        href = urljoin(page_url, a["href"]).split("#")[0]
        if PDF_RE.search(href):
            label = clean(" ".join((a.get("title", ""), a.get_text(" ", strip=True))))
            links.append((href, label))
    return list(dict.fromkeys(links))


def link_date(href: str, label: str) -> date:
    m = DATE_RE.search(f"{label} {href.replace('-', ' ')}")
    if m:
        return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    m = re.search(r"/(20\d{2})-(\d{2})/", href)
    return date(int(m.group(1)), int(m.group(2)), 1) if m else date.min


def choose_latest_tracker(html: str, page_url: str = TRACKER_INDEX) -> tuple[str, date]:
    links = pdf_links(html, page_url)
    tracker_links = [(u, l) for u, l in links if "tracker" in f"{u} {l}".lower()]
    if not tracker_links:
        raise RuntimeError("The official tracker page contained no tracker PDF links")
    href, label = max(tracker_links, key=lambda item: link_date(*item))
    return href, link_date(href, label)


def extract_pdf(pdf_bytes: bytes, layout: bool = True) -> str:
    with tempfile.TemporaryDirectory(prefix="legsync-") as directory:
        pdf = Path(directory) / "source.pdf"
        txt = Path(directory) / "source.txt"
        pdf.write_bytes(pdf_bytes)
        try:
            mode = "-layout" if layout else "-raw"
            subprocess.run(["pdftotext", mode, str(pdf), str(txt)], check=True, capture_output=True, text=True)
        except FileNotFoundError as exc:
            raise RuntimeError("pdftotext is required to parse the Parliament tracker PDF") from exc
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(f"Could not extract tracker PDF text: {exc.stderr}") from exc
        return txt.read_text(encoding="utf-8", errors="replace")


def _row_blocks(text_value: str) -> Iterable[list[str]]:
    block: list[str] = []
    for line in text_value.splitlines():
        if re.match(r"^\s*\d+\.\s+", line):
            if block:
                yield block
            block = [line]
        elif block:
            # Repeat headers and page breaks are not bill data.
            upper = line.upper()
            is_header = any(marker in upper for marker in (
                "LEGISLATIVE PROPOSALS TRACKER",
                "REPUBLIC OF KENYA",
                "THIRTEENTH PARLIAMENT",
                "THE NATIONAL ASSEMBLY",
            ))
            if not is_header and not line.strip().startswith("S. NO") and not re.match(r"^\s*Page\s+\d+", line, re.I):
                block.append(line)
    if block:
        yield block


def normalize_committee_terms(value: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", value.casefold().replace("&", " and "))
    tokens = [token for token in tokens if token not in {"departmental", "committee", "committees", "on", "the", "national", "assembly"}]
    tokens = ["appropriation" if token == "appropriations" else token for token in tokens]
    return " ".join(tokens)


def committee_key(value: str) -> str:
    normalized = normalize_committee_terms(value)
    return COMMITTEE_KEY_ALIASES.get(normalized, normalized)


def normalize_tracker_reference(value: str) -> str:
    """Rejoin file-reference fragments split across PDF columns or lines."""
    normalized = re.sub(r"(?i)\b(DLS/NA/|NA/DLS/)\s*B\s*ILLS/", r"\1BILLS/", clean(value))
    return re.sub(r"(?i)(/BILLS/[12]/)\s+(\d{1,2}/20\d{2})\b", r"\1\2", normalized)


def extract_committee_assignment(status_text: str, committee_names: Iterable[str]) -> str | None:
    """Return a directory committee only when the tracker status names one unambiguously."""
    normalized_status = normalize_committee_terms(status_text)
    if not normalized_status:
        return None
    matches: dict[str, str] = {}
    for name in committee_names:
        key = committee_key(name)
        phrase = normalize_committee_terms(name)
        if not key or not phrase:
            continue
        variants = [phrase]
        variants.extend(alias for alias, canonical in COMMITTEE_KEY_ALIASES.items() if canonical == key)
        if any(re.search(rf"(?<![a-z0-9]){re.escape(variant)}(?![a-z0-9])", normalized_status) for variant in set(variants)):
            matches.setdefault(key, name)
    return next(iter(matches.values())) if len(matches) == 1 else None


def parse_tracker(text_value: str, source_url: str, as_at: date, committee_names: Iterable[str] = ()) -> list[BillRow]:
    rows: list[BillRow] = []
    for block in _row_blocks(text_value):
        joined = clean(" ".join(block))
        # The bill number and year occupy their own fixed-width cell. Reading
        # that cell across wrapped lines avoids confusing the bill year with
        # the proposal's title year or its DLS file-reference year.
        bill_column_text = clean(" ".join(line[78:95] for line in block if len(line) > 78))
        ref = BILL_REF_RE.search(bill_column_text) or BILL_REF_RE.search(joined)
        tracker_head = TRACKER_BILL_HEAD_RE.search(bill_column_text) or TRACKER_BILL_HEAD_RE.search(joined)
        generic = GENERIC_BILL_REF_RE.search(joined)
        house = canonical_house(ref.group("house") if ref else (tracker_head.group("house") if tracker_head else "na")) or "na"
        number = int(ref.group("number")) if ref else (int(tracker_head.group("number")) if tracker_head else (int(generic.group(1)) if generic else None))
        year = int(ref.group("year")) if ref else (int(generic.group(2)) if generic else 0)
        if not year and tracker_head:
            years_in_block = YEAR_RE.findall(joined)
            year = int(years_in_block[-1]) if years_in_block else 0
        if not year:
            years = YEAR_RE.findall(joined)
            year = int(years[-1]) if years else as_at.year

        # PDF text extraction can place the first/last title glyph just outside
        # the nominal cell boundary. Start slightly early, then strip sponsor
        # text at the title/sponsor boundary.
        title_parts = []
        for line in block:
            if len(line) > 30:
                piece = line[28:78]
                piece = re.sub(r"\b(?:Hon\.|Dr\.|Prof\.|Sen\.|Ms\.)\s*.*", "", piece, flags=re.I)
                piece = re.sub(r"\b(?:Chairperson|Member|Governor)\b\s*.*", "", piece, flags=re.I)
                if piece.strip():
                    title_parts.append(piece)
        title = clean(" ".join(title_parts))
        if not title or "title/subject" in title.lower():
            continue
        if not re.search(r"\b(bill|amendment|appropriation|finance|fund)\b", title, re.I):
            continue
        file_ref_column = clean(" ".join(line[:28] for line in block))
        file_match = FILE_REF_RE.search(normalize_tracker_reference(file_ref_column))
        file_ref = clean(file_match.group(0)) if file_match else None
        suffix = f"Bill-{number:03d}" if number is not None else f"Proposal-{hashlib.sha1((file_ref or title).encode()).hexdigest()[:10]}"
        identifier = f"{house.upper()}/{year}/{suffix}"
        stage = extract_stage(joined)
        # The official PDF is fixed-width. Column 85 begins in the status cell,
        # excluding committee names in bill titles, sponsors, and bill numbers.
        status_text = clean(" ".join(line[85:] for line in block if len(line) > 85))
        committee_name = extract_committee_assignment(status_text, committee_names)
        rows.append(BillRow(title=title, identifier=identifier, house=house, number=number, year=year, stage=stage, source_url=source_url, source_file_ref=file_ref, committee_name=committee_name))
    unique: dict[str, BillRow] = {}
    conflicting_assignments: set[str] = set()
    for row in rows:
        if row.identifier in conflicting_assignments:
            continue
        prior = unique.get(row.identifier)
        if prior and prior.committee_name and row.committee_name and committee_key(prior.committee_name) != committee_key(row.committee_name):
            unique[row.identifier] = replace(prior, committee_name=None)
            conflicting_assignments.add(row.identifier)
        elif prior and prior.committee_name and row.committee_name is None:
            continue
        else:
            unique[row.identifier] = row
    if len(unique) < 5:
        raise RuntimeError(f"Tracker parser produced only {len(unique)} bills; refusing a partial sync")
    return list(unique.values())


NUMERIC_DATE_PARTS_RE = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(20\d{2})\b")
OFFICIAL_TITLE_RE = re.compile(r"\bbill\s*,?\s*20\d{2}\s*$", re.I)
COMMITTEE_STAGE_RE = re.compile(r"committee\s+stage", re.I)


def tracker_dates(value: str) -> list[date]:
    """Parse the d/m/yyyy dates the Bills Tracker uses, skipping impossible ones."""
    found = []
    for day, month, year in NUMERIC_DATE_PARTS_RE.findall(value or ""):
        try:
            found.append(date(int(year), int(month), int(day)))
        except ValueError:
            continue
    return found


def build_stage_history(columns: dict[str, str]) -> tuple[dict, ...]:
    """Turn the dated Bills Tracker columns into the bill's legislative timeline.

    National Assembly procedure: a bill is published in the Kenya Gazette, read a
    First Time and committed to a departmental committee (which runs public
    participation), debated at Second Reading, considered clause by clause in the
    Committee of the Whole House (the tracker's "Committee Stage"), read a Third
    Time, and finally assented to by the President.
    """
    events: list[dict] = []

    def add(when: date, stage: str, note: str) -> None:
        events.append({"date": when.isoformat(), "stage": stage, "note": note})

    published = tracker_dates(columns.get("published", ""))
    if published:
        add(published[0], "Published", "Published in the Kenya Gazette.")
    first = tracker_dates(columns.get("first_read", ""))
    if first:
        add(first[0], "First Reading", "Read a First Time and committed to the relevant departmental committee for public participation and scrutiny.")
    # The 2nd-reading cell lists Second Reading sittings, then
    # "Committee Stage: <date>" for the Committee of the Whole House.
    second_cell = columns.get("second_read", "")
    split = COMMITTEE_STAGE_RE.split(second_cell, maxsplit=1)
    second = tracker_dates(split[0])
    if second:
        sittings = ", ".join(day.isoformat() for day in second)
        add(second[0], "Second Reading", f"Second Reading debate (sittings: {sittings}).")
    committee_whole = tracker_dates(split[1]) if len(split) > 1 else []
    if committee_whole:
        add(committee_whole[0], "Committee of the Whole House", "Considered clause by clause in the Committee of the Whole House.")
    third = tracker_dates(columns.get("third_read", ""))
    if third:
        add(third[0], "Third Reading", "Read a Third Time and passed by the National Assembly.")
    assent = tracker_dates(columns.get("assent", ""))
    if assent:
        add(assent[0], "Assented", "Assented to by the President.")
    return tuple(events)


def parse_bill_stage_tracker(
    text_value: str,
    source_url: str,
    as_at: date,
    layout_text: str = "",
    committee_names: Iterable[str] = (),
) -> list[BillRow]:
    """Parse bill identities/stages and explicit committee sponsors from the official tracker."""
    rows: dict[str, BillRow] = {}
    ambiguous: set[str] = set()
    column_rows = parse_bill_tracker_columns(layout_text)
    for block in _row_blocks(text_value):
        joined = clean(" ".join(block))
        reference = BILL_TRACKER_REF_RE.search(joined)
        if not reference:
            continue
        serial_match = re.match(r"^\s*(\d+)\.\s+", block[0])
        row_columns = column_rows.get(int(serial_match.group(1)), {}) if serial_match else {}
        assent = row_columns.get("assent", "")
        if NUMERIC_DATE_RE.search(assent):
            stage = "Assented"
        else:
            stage = extract_current_bill_stage(row_columns.get("remarks", ""))
            if not stage and not row_columns:
                stage = extract_current_bill_stage(joined)
        if not stage:
            second_read = row_columns.get("second_read", "")
            third_read = row_columns.get("third_read", "")
            if re.search(r"\bcommittee\s+stage\b", second_read + third_read, re.I) and not NUMERIC_DATE_RE.search(third_read):
                stage = "Committee Stage"
            elif NUMERIC_DATE_RE.search(third_read):
                stage = "Third Reading"
            elif NUMERIC_DATE_RE.search(second_read):
                stage = "Second Reading"
            elif NUMERIC_DATE_RE.search(row_columns.get("first_read", "")):
                stage = "First Reading"
        if not stage:
            continue
        # In raw PDF order, the official title appears before the sponsor and
        # bill reference. Use its terminal "Bill, YYYY" marker to avoid title
        # cells bleeding into adjacent sponsor columns in wide tracker rows.
        title_prefix = re.sub(r"^\s*\d+\.\s*", "", joined[:reference.start()])
        title_match = re.search(r"^.*?\bbill\s*,?\s*20\d{2}\b", title_prefix, re.I)
        if not title_match:
            title_match = re.search(r"^.*?\bbill\b", title_prefix, re.I)
        if title_match:
            title = title_match.group(0)
        else:
            # Some tracker rows split at a PDF page boundary: the bill number
            # and dates precede a final title fragment such as "(Amendment)
            # Bill, 2026" on the next page. Rejoin only a clear terminal
            # title marker, after removing the sponsor cell from the prefix.
            continuation = re.search(
                r"(\([^)]*\)\s*)?Bill\s*,?\s*20\d{2}\b",
                joined[reference.end():],
                re.I,
            )
            if continuation:
                title_head = re.split(
                    # Senate bills are sponsored by "Sen. ..." (often "Sen. (Prof.) ...").
                    r"\b(?:Hon\.|Sen\.|Dr\.|Chairperson\b|Leader of the Majority Party\b|Leader of the Minority Party\b)",
                    title_prefix,
                    maxsplit=1,
                    flags=re.I,
                )[0]
                title = f"{title_head} {continuation.group(0)}"
            else:
                title = row_columns.get("title", "")
        title = clean(title).rstrip(" (")
        if not title or not re.search(r"\bbill\b", title, re.I):
            continue
        house = canonical_house(reference.group("house")) or "na"
        number = int(reference.group("number"))
        year = int(reference.group("year"))
        identifier = f"{house.upper()}/{year}/Bill-{number:03d}"
        sponsor = clean(title_prefix[title_match.end():]) if title_match else row_columns.get("sponsor", "")
        committee_name = extract_committee_assignment(sponsor, committee_names)
        row = BillRow(
            title=title[:BILL_LIMITS["title"]],
            identifier=identifier,
            house=house,
            number=number,
            year=year,
            stage=stage,
            source_url=source_url,
            source_file_ref=None,
            committee_name=committee_name,
            stage_source_url=source_url,
            stage_as_at=as_at,
            history=build_stage_history(row_columns),
        )
        if identifier in ambiguous:
            continue
        prior = rows.get(identifier)
        if prior and prior.stage != row.stage:
            log.warning("Conflicting current stages in official Bills Tracker for %s; leaving stage unchanged", identifier)
            rows.pop(identifier, None)
            ambiguous.add(identifier)
        else:
            rows[identifier] = row
    return list(rows.values())


def merge_bill_stage_rows(bills: list[BillRow], stage_rows: list[BillRow]) -> list[BillRow]:
    """Merge exact/unique bill matches and add official tracker-only bill records."""
    merged = list(bills)
    positions = {row.identifier: index for index, row in enumerate(merged)}
    title_positions: dict[tuple[str, int], list[int]] = {}
    for index, row in enumerate(merged):
        title_positions.setdefault((canonical_title(row.title), row.year), []).append(index)
    stage_title_counts: dict[tuple[str, int], int] = {}
    for row in stage_rows:
        key = (canonical_title(row.title), row.year)
        stage_title_counts[key] = stage_title_counts.get(key, 0) + 1
    for stage_row in stage_rows:
        index = positions.get(stage_row.identifier)
        if index is None:
            key = (canonical_title(stage_row.title), stage_row.year)
            candidates = title_positions.get(key, [])
            if candidates:
                # Only reconcile a proposal row when the title/year is unique
                # on both sides. Ambiguous matches are left untouched.
                if stage_title_counts.get(key) != 1 or len(candidates) != 1:
                    continue
                index = candidates[0]
            else:
                # The latest official Bills Tracker is also a source of new
                # bill identities, not just a stage update for older proposal
                # tracker records.
                positions[stage_row.identifier] = len(merged)
                title_positions.setdefault(key, []).append(len(merged))
                merged.append(stage_row)
                continue
        current = merged[index]
        exact_match = current.identifier == stage_row.identifier
        # Proposal-tracker titles are working titles (often with the drafting
        # year). On an exact house/number/year match, the official bill title
        # wins when it parsed cleanly as "... Bill, YYYY".
        title = stage_row.title if exact_match and OFFICIAL_TITLE_RE.search(stage_row.title) else current.title
        merged[index] = replace(
            current,
            title=title,
            history=stage_row.history or current.history,
            stage=stage_row.stage,
            committee_name=current.committee_name or stage_row.committee_name,
            stage_source_url=stage_row.stage_source_url,
            stage_as_at=stage_row.stage_as_at,
        )
    return merged


def discover_notice_urls(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    urls = []
    for a in soup.select("a[href]"):
        label = clean(a.get_text(" ", strip=True))
        href = a["href"]
        if "memor" in f"{label} {href}".lower() or "invitation" in href.lower():
            candidate = href if href.startswith("http") else urljoin(BASE, href.lstrip("/"))
            if urlparse(candidate).netloc in {"parliament.go.ke", "www.parliament.go.ke"}:
                urls.append(candidate.split("#")[0])
    return list(dict.fromkeys(urls))


# "to be received on or before Friday, 26 th September, 2025 at 5.00 p.m."
# "All submissions must be received by 5:00 pm on Thursday, 28th August 2025"
NOTICE_DEADLINE_RE = re.compile(
    r"(?:on\s+or\s+before|not\s+later\s+than|received\s+by|deadline\s*:?)\s*"
    r"(?:[\d.:]+\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)\s*(?:on\s+)?)?"
    r"(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day\s*,?\s*)?"
    r"(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*,?\s*(20\d{2})",
    re.I,
)
# "THE PLANT PROTECTION BILL, 2025 (NATIONAL ASSEMBLY BILLS NO. 28 OF 2025)"
NOTICE_FORMAL_BILL_RE = re.compile(
    r"\bTHE\s+([A-Z][A-Za-z0-9 &'’(),./-]{2,140}?\bBILL)\s*,?\s*(?:20\d{2})?\s*"
    r"\(\s*(NATIONAL\s+ASSEMBLY|SENATE)\s+BILLS?\s+NO\.?\s*(\d+)\s+OF\s*(20\d{2})\s*\)",
    re.I,
)
# Fragments that the line scan used to mistake for bill titles.
NOTICE_JUNK_TITLE_RE = re.compile(
    r"^(?:\(|amendment\)|national\s+assembly\s+bill|senate\s+bill|bill\s+no|it\s+is\s+notified|invitation|notification|"
    r"submitted\s+by|and\s+whereas|hearings|assembly\s+bill)|\bis\s+a\s+bill\b|\bthe\s+kenyan\s+parliament\s+website\b"
    # Prose fragments such as "Read the Bill" or "M.P. The Bill" name no bill.
    r"|^(?:[\w.]+\s+){0,2}the\s+bill$",
    re.I,
)


# A bill's name inside prose: capitalised words (and short joining words or a
# bracketed part such as "(Amendment)") ending in "Bill".
BILL_NAME_RE = re.compile(
    r"((?:[A-Z][A-Za-z'’&.-]*|\([A-Za-z0-9 .'’-]{1,40}\))(?:\s+(?:[A-Z][A-Za-z'’&.-]*|\([A-Za-z0-9 .'’-]{1,40}\)|of|and|for|on|in|to|the|OF|AND|FOR|ON|IN|TO|THE))*\s+(?:Bill|BILL))\b"
)
PROSE_PREFIX_RE = re.compile(
    r"^.*?\b(?:consideration\s+by\s+the\s+(?:national\s+assembly|senate)\s+of|memoranda\s+on|views\s+on|submissions\s+on)\s+(?:the\s+)?",
    re.I,
)


def bill_name_from_text(line: str) -> str | None:
    """The bill's name from a sentence such as "...invites memoranda on the X Bill (Senate Bills No. 2 of 2026)"."""
    line = PROSE_PREFIX_RE.sub("", clean(line))
    for match in BILL_NAME_RE.finditer(line):
        name = re.sub(r"^(?:The|And|Of|On|In|To)\s+", "", clean(match.group(1)))
        words = name.split()
        if 2 <= len(words) <= 16 and not NOTICE_JUNK_TITLE_RE.search(name) and not re.match(r"^(?:Senate|National Assembly|Standing|Committee)\b", name, re.I):
            return name
    return None


def notice_deadline(text: str) -> date | None:
    """The closing date for memoranda, or None when the notice does not state one in text."""
    for match in NOTICE_DEADLINE_RE.finditer(text):
        month = MONTHS.get(match.group(2).lower())
        if month:
            try:
                return date(int(match.group(3)), month, int(match.group(1)))
            except ValueError:
                continue
    return None


def canonical_notice_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.replace("/index.php/", "/").rstrip("/")
    return f"https://www.parliament.go.ke{path}"


def notice_page_links(html: str, page_url: str) -> list[str]:
    """Links on a Parliament page that point to an individual call for memoranda."""
    found = []
    for a in BeautifulSoup(html, "lxml").select("a[href]"):
        url = urljoin(page_url, a["href"]).split("#")[0]
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if host not in {"parliament.go.ke", "www.parliament.go.ke"} or PDF_RE.search(url):
            continue
        path = parsed.path.replace("/index.php/", "/").rstrip("/")
        if not NOTICE_SLUG_RE.search(path) or path in STALE_NOTICE_PATHS or path.startswith(("/search", "/intranet", "/user")):
            continue
        found.append(canonical_notice_url(url))
    return list(dict.fromkeys(found))


async def discover_notice_pages(client: httpx.AsyncClient) -> list[str]:
    """Find current calls for memoranda through the House pages and the site search."""
    urls: list[str] = []
    pages = list(NOTICE_SEED_PAGES) + [
        f"{BASE}/search/node?keys={query.replace(' ', '+')}&page={page}"
        for query in NOTICE_SEARCH_QUERIES for page in range(NOTICE_SEARCH_PAGES)
    ]
    for page_url in pages:
        try:
            response = await get(client, page_url)
        except httpx.HTTPError as exc:
            log.warning("Notice discovery page unavailable %s: %s", page_url, exc)
            continue
        urls.extend(notice_page_links(response.text, page_url))
        await asyncio.sleep(POLITE_DELAY_S)
    return list(dict.fromkeys(urls))


def parse_date_from_text(value: str) -> date | None:
    m = DATE_RE.search(value)
    return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))) if m else None


def parse_notice_page(html: str, url: str, attachment_text: str = "") -> list[NoticeRow]:
    soup = BeautifulSoup(html, "lxml")
    article = soup.select_one("article") or soup
    text_value = clean(article.get_text(" ", strip=True))
    source_text = clean(f"{text_value} {attachment_text}")
    published = re.search(r"Submitted\s+by.*?on\s+([^,]+?20\d{2})", text_value, re.I)
    notice_date = parse_date_from_text(published.group(1)) if published else None
    if not notice_date:
        notice_date = parse_date_from_text(text_value)
    deadline = notice_deadline(source_text)
    if deadline is None:
        deadline_match = re.search(r"(?:on or before|to be received[^.]{0,50}\bon or before|by)\s+(?:\w+\s*,?\s*)?(\d{1,2})\s*(?:st|nd|rd|th)?\s+(\w+)\s+(20\d{2})", source_text, re.I)
        deadline = date(int(deadline_match.group(3)), MONTHS[deadline_match.group(2).lower()], int(deadline_match.group(1))) if deadline_match and deadline_match.group(2).lower() in MONTHS else None
    if notice_date and deadline and notice_date > deadline:
        # Pages are sometimes posted after the deadline; the window opened on the
        # latest date in the notice that comes before its closing date.
        earlier = []
        for match in DATE_RE.finditer(source_text):
            try:
                found = date(int(match.group(3)), MONTHS[match.group(2).lower()], int(match.group(1)))
            except (KeyError, ValueError):
                continue
            if found < deadline:
                earlier.append(found)
        notice_date = max(earlier) if earlier else None
    if not notice_date or not deadline:
        log.warning("Skipping notice without both publication date and deadline: %s", url)
        return []

    committee = "National Assembly Committee"
    committee_match = re.search(r"((?:Departmental\s+)?Committee\s+(?:on|of)\s+[A-Z][^.;]{2,120})", source_text)
    if committee_match:
        committee = clean(re.split(r"\s+for consideration\b", committee_match.group(1), flags=re.I)[0])

    document_urls = tuple(urljoin(url, a["href"]).split("#")[0] for a in article.select("a[href]") if PDF_RE.search(a["href"]))
    candidates = []
    seen_candidate_keys: set[str] = set()
    candidate_refs: dict[str, re.Match[str] | None] = {}
    structured_refs: dict[str, tuple[int, int]] = {}
    formal_text = source_text.split("WHEREAS", 1)[0]
    structured_houses: dict[str, str] = {}
    for formal in NOTICE_FORMAL_BILL_RE.finditer(formal_text):
        formal_title = clean(formal.group(1))
        formal_title = re.sub(r"^(?:AND\s+\(\d+\)\s+)?THE\s+", "", formal_title, flags=re.I)
        # A run of several bills ("...; (2) THE X BILL (...)") keeps only the last title.
        formal_title = clean(re.split(r"\(\d+\)\s+THE\s+|;\s*", formal_title, flags=re.I)[-1])
        # Prose ("…invites the public to submit memoranda on the X Bill") keeps only the bill's name.
        formal_title = bill_name_from_text(formal_title) or (formal_title if len(formal_title.split()) <= 12 else "")
        if not formal_title:
            continue
        formal_key = canonical_title(formal_title)
        if formal_key and formal_key not in seen_candidate_keys and not NOTICE_JUNK_TITLE_RE.search(formal_title):
            candidates.append(formal_title)
            seen_candidate_keys.add(formal_key)
            structured_refs[formal_title] = (int(formal.group(3)), int(formal.group(4)))
            structured_houses[formal_title] = canonical_house(formal.group(2)) or "na"
    for line in ([] if structured_refs else f"{article.get_text(chr(10), strip=True)}\n{attachment_text}".splitlines()):
        line = clean(line)
        if re.search(r"\bbill\b", line, re.I) and len(line) >= 10:
            candidate = bill_name_from_text(line)
            if not candidate:
                continue
            candidate = re.sub(r"\s*\([^)]*(?:bill\s+no|national assembly)[^)]*\)", "", candidate, flags=re.I)
            candidate = re.sub(r"\s+20\d{2}\s*$", "", candidate)
            candidate_key = canonical_title(candidate)
            if candidate_key and candidate_key not in seen_candidate_keys and not NOTICE_JUNK_TITLE_RE.search(candidate) and len(candidate.split()) >= 2:
                candidates.append(candidate)
                seen_candidate_keys.add(candidate_key)
                candidate_refs[candidate] = BILL_REF_RE.search(line) or GENERIC_BILL_REF_RE.search(line)
    if not candidates:
        log.info("Notice names no bill; skipping: %s", url)
        return []

    rows = []
    for title in candidates:
        if title in structured_refs:
            number, year = structured_refs[title]
            house = structured_houses.get(title, "na")
            rows.append(NoticeRow(title=text_value[:500], source_url=url, notice_date=notice_date, deadline=deadline, committee_name=committee, bill_title=title, bill_house=house, bill_number=number, bill_year=year, document_urls=document_urls))
            continue
        ref = candidate_refs.get(title)
        if ref and "house" in ref.groupdict():
            generic = None
        else:
            generic = ref or GENERIC_BILL_REF_RE.search(title)
            ref = None
        house = canonical_house(ref.group("house") if ref else "na") or "na"
        number = int(ref.group("number")) if ref else (int(generic.group(1)) if generic else None)
        year = int(ref.group("year")) if ref else (int(generic.group(2)) if generic else (YEAR_RE.search(title).group(1) if YEAR_RE.search(title) else notice_date.year))
        rows.append(NoticeRow(title=text_value[:500], source_url=url, notice_date=notice_date, deadline=deadline, committee_name=committee, bill_title=title, bill_house=house, bill_number=number, bill_year=int(year), document_urls=document_urls))
    unique: dict[tuple, NoticeRow] = {}
    for row in rows:
        key = (row.bill_house, row.bill_number, row.bill_year) if row.bill_number is not None else ("title", canonical_title(row.bill_title), row.bill_year)
        unique.setdefault(key, row)
    return list(unique.values())


@dataclass(frozen=True)
class Committee:
    name: str
    url: str
    group: str


def discover_committees(html: str) -> list[Committee]:
    soup = BeautifulSoup(html, "lxml")
    anchors = soup.select("#quicktabs-the_national_assembly_committees a[href]")
    if not anchors:
        anchors = soup.select("nav.menu--committees a[href]")
    found: dict[str, Committee] = {}
    section_labels = {
        "committee",
        "departmental committees",
        "audit, appropriations and general purpose committees",
        "other committees (2017-2022)",
    }
    for a in anchors:
        name = clean(a.get_text(" ", strip=True))
        raw_href = a.get("href", "").split("#")[0]
        if not name or name.casefold() in section_labels or "2017-2022" in name:
            continue
        if any("other committees (2017-2022)" in clean(parent.get_text(" ", strip=True)).casefold() for parent in a.find_parents("li", class_="menu-item--expanded")):
            continue
        href = urljoin(BASE, raw_href)
        parsed = urlparse(href)
        if parsed.netloc.lower() not in {"www.parliament.go.ke", "parliament.go.ke"}:
            continue
        path = parsed.path.replace("/index.php/", "/")
        if not path or path == "/" or raw_href.startswith("#"):
            continue
        href = f"{BASE}{path}"
        key = committee_key(name)
        if key:
            # Keep the official directory label and URL, but collapse duplicate
            # links and spelling variants to one committee entry.
            found.setdefault(key, Committee(name, href, "National Assembly"))
    return list(found.values())


def parse_reports(html: str, committee: Committee) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    blocks = [li for li in soup.find_all("li") if "committee reports" in li.get_text(" ", strip=True).lower()]
    links = [a for block in blocks for a in block.select("a[href]")] or soup.select("a[href]")
    rows: dict[str, dict] = {}
    for a in links:
        href = urljoin(BASE, a["href"]).split("#")[0]
        if not PDF_RE.search(href) or href in rows:
            continue
        label = clean(a.get("title", "") or a.get_text(" ", strip=True))
        if not label or re.match(r"the hansard|order paper", label, re.I):
            continue
        ref = BILL_REF_RE.search(label)
        generic = GENERIC_BILL_REF_RE.search(label)
        house = canonical_house(ref.group("house") if ref else None)
        number = int(ref.group("number")) if ref else (int(generic.group(1)) if generic else None)
        year = int(ref.group("year")) if ref else (int(generic.group(2)) if generic else None)
        month = MONTH_RE.search(href)
        rows[href] = {"committee_name": committee.name, "committee_url": committee.url, "institution": "National Assembly", "title": label, "source_url": href, "date_tabled": date(int(month.group(1)), int(month.group(2)), 1) if month else None, "bill_house": house, "bill_number": number, "bill_year": year}
    return list(rows.values())


SCHEMA_SQL = """
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS bill_house VARCHAR(20);
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS bill_number INTEGER;
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS bill_year INTEGER;
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS source_url VARCHAR(1000);
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS source_file_ref VARCHAR(255);
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS source_updated_at DATE;
ALTER TABLE legislative_items ADD COLUMN IF NOT EXISTS source_status VARCHAR(100);
ALTER TABLE notice_records ADD COLUMN IF NOT EXISTS source_url VARCHAR(1000);
ALTER TABLE notice_records ADD COLUMN IF NOT EXISTS source_title VARCHAR(500);
ALTER TABLE notice_records ADD COLUMN IF NOT EXISTS committee_name VARCHAR(255);
ALTER TABLE notice_records ADD COLUMN IF NOT EXISTS published_date DATE;
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS committee_name VARCHAR(255);
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS committee_url VARCHAR(1000);
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS title VARCHAR(1000);
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS bill_house VARCHAR(20);
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS bill_number INTEGER;
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS bill_year INTEGER;
ALTER TABLE committee_reports ADD COLUMN IF NOT EXISTS source_url VARCHAR(1000);
ALTER TABLE committee_reports ALTER COLUMN bill_ref DROP NOT NULL;
DROP INDEX IF EXISTS uq_notice_source_url;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_source_bill ON notice_records(source_url, bill_ref) WHERE source_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_source_committee ON committee_reports(source_url, committee_url) WHERE source_url IS NOT NULL AND committee_url IS NOT NULL;
CREATE TABLE IF NOT EXISTS legislative_link_reviews (
    id BIGSERIAL PRIMARY KEY,
    report_ref UUID NOT NULL REFERENCES committee_reports(id),
    candidate_bill_ref UUID NOT NULL REFERENCES legislative_items(id),
    match_method VARCHAR(30) NOT NULL,
    confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    explanation TEXT NOT NULL,
    reviewer_decision VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (reviewer_decision IN ('pending','confirmed','rejected')),
    reviewer_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(report_ref, candidate_bill_ref)
);
"""


def bill_documents(row: BillRow) -> list[dict]:
    documents = []
    if row.source_url and row.source_url != row.stage_source_url:
        documents.append({"name": "Legislative Proposals Tracker", "url": row.source_url})
    if row.stage_source_url:
        date_label = f" as at {row.stage_as_at.strftime('%d %B %Y')}" if row.stage_as_at else ""
        documents.append({"name": f"Official Bills Tracker — current stage{date_label}", "url": row.stage_source_url})
    return documents


TRACKER_DOCUMENT_NAMES = re.compile(r"^(legislative proposals tracker|official bills tracker\b)", re.I)


def merge_tracker_documents(existing, row: BillRow) -> list[dict]:
    """Replace tracker links with the current ones; keep bill PDFs and notices."""
    if isinstance(existing, str):
        try:
            existing = json.loads(existing)
        except json.JSONDecodeError:
            existing = []
    kept = [
        document for document in (existing if isinstance(existing, list) else [])
        if isinstance(document, dict) and not TRACKER_DOCUMENT_NAMES.search(str(document.get("name", "")))
    ]
    merged: list[dict] = []
    seen: set[str] = set()
    for document in [*bill_documents(row), *kept]:
        key = document.get("url") or document.get("storage_ref") or document.get("name", "")
        if key in seen:
            continue
        seen.add(key)
        merged.append(document)
    return merged


GENERIC_COMMITTEE_NAMES = {"committee", "national assembly committee", "national assembly"}


async def ensure_committee_id(conn, name: str | None, institution: str = "National Assembly"):
    """Find or create the committee named by an official Parliament source."""
    clean_name = clean(name or "")
    if not clean_name or clean_name.casefold() in GENERIC_COMMITTEE_NAMES:
        return None
    key = committee_key(clean_name)
    result = await conn.execute(text("SELECT id,name FROM committees WHERE lower(trim(institution))=lower(trim(:institution)) ORDER BY id"), {"institution": institution or "National Assembly"})
    matches = [row for row in result.fetchall() if key and committee_key(row[1]) == key]
    if matches:
        target = next((row for row in matches if row[1].casefold() == clean_name.casefold()), matches[0])
        committee_id = target[0]
        if target[1].casefold() != clean_name.casefold():
            name_conflict = (await conn.execute(text("SELECT id FROM committees WHERE lower(trim(name))=lower(trim(:name)) ORDER BY id LIMIT 1"), {"name": clean_name})).first()
            if not name_conflict or name_conflict[0] == committee_id:
                await conn.execute(text("UPDATE committees SET name=:name WHERE id=:id"), {"id": committee_id, "name": clean_name})
        for duplicate in matches:
            if duplicate[0] == committee_id:
                continue
            duplicate_id = duplicate[0]
            await conn.execute(text("UPDATE legislative_items SET committee_id=:canonical WHERE committee_id=:duplicate"), {"canonical": committee_id, "duplicate": duplicate_id})
            await conn.execute(text("UPDATE users SET committee_id=:canonical WHERE committee_id=:duplicate"), {"canonical": committee_id, "duplicate": duplicate_id})
            # RepresentativeProfile stores memberships as text[] labels, not a committee_id FK.
            await conn.execute(text("DELETE FROM committees WHERE id=:duplicate"), {"duplicate": duplicate_id})
        return committee_id

    committee_id = uuid.uuid4()
    await conn.execute(
        text("INSERT INTO committees (id,name,institution,status) VALUES (:id,:name,:institution,'active') ON CONFLICT (name) DO NOTHING"),
        {"id": committee_id, "name": clean_name, "institution": institution or "National Assembly"},
    )
    existing = await conn.execute(
        text("SELECT id FROM committees WHERE lower(trim(name))=lower(trim(:name)) ORDER BY id LIMIT 1"),
        {"name": clean_name},
    )
    row = existing.first()
    return row[0] if row else None


async def merge_bill_document(conn, bill_id, name: str, url: str) -> None:
    """Add a Parliament document to a bill without duplicating or replacing its tracker."""
    if not url:
        return
    result = await conn.execute(text("SELECT documents FROM legislative_items WHERE id=:id"), {"id": bill_id})
    row = result.first()
    if not row:
        return
    documents = row[0] or []
    if isinstance(documents, str):
        try:
            documents = json.loads(documents)
        except json.JSONDecodeError:
            documents = []
    documents = list(documents) if isinstance(documents, (list, tuple)) else []
    if any(isinstance(document, dict) and document.get("url") == url for document in documents):
        return
    documents.append({"name": name, "url": url})
    await conn.execute(
        text("UPDATE legislative_items SET documents=CAST(:documents AS jsonb) WHERE id=:id"),
        {"id": bill_id, "documents": json.dumps(documents)},
    )


# --------------------------------------------------------------------------
# Bills
# --------------------------------------------------------------------------
def validate_bill(row: BillRow) -> str | None:
    """Return a reason to skip the row, or None if it is safe to store."""
    for field in ("title", "identifier", "stage"):
        if not getattr(row, field):
            return f"missing required field '{field}'"
    for field, limit in BILL_LIMITS.items():
        value = getattr(row, field, None)
        if isinstance(value, str) and len(value) > limit:
            return f"'{field}' too long ({len(value)} > {limit})"
    return None


async def _upsert_bill(conn, row: BillRow, as_at: date) -> bool:
    """Insert or update one bill. Returns True if a new row was inserted."""
    result = await conn.execute(text("SELECT id, documents FROM legislative_items WHERE identifier=:identifier"), {"identifier": row.identifier})
    exists = result.first()
    committee_id = await ensure_committee_id(conn, row.committee_name) if row.committee_name else None
    documents = merge_tracker_documents(exists[1] if exists else [], row)
    params = {
        "title": row.title,
        "identifier": row.identifier,
        "institution": "National Assembly",
        "stage": row.stage,
        "documents": json.dumps(documents),
        "status_history": json.dumps(list(row.history)),
        "has_history": bool(row.history),
        "bill_house": row.house,
        "bill_number": row.number,
        "bill_year": row.year,
        "source_url": row.source_url,
        "source_file_ref": row.source_file_ref,
        "source_updated_at": row.stage_as_at or as_at,
        "source_status": row.stage,
        "committee_id": committee_id,
    }
    if exists:
        await conn.execute(text("""UPDATE legislative_items SET title=:title, institution=:institution, stage=:stage, documents=CAST(:documents AS jsonb), status_history=CASE WHEN :has_history THEN CAST(:status_history AS json) ELSE status_history END, bill_house=:bill_house, bill_number=:bill_number, bill_year=:bill_year, source_url=:source_url, source_file_ref=:source_file_ref, source_updated_at=:source_updated_at, source_status=:source_status, committee_id=CASE WHEN committee_assignment_source='administrator' THEN committee_id ELSE COALESCE(CAST(:committee_id AS uuid),committee_id) END, committee_assignment_source=CASE WHEN committee_assignment_source='administrator' THEN committee_assignment_source WHEN CAST(:committee_id AS uuid) IS NOT NULL THEN 'official record' ELSE committee_assignment_source END, is_simulated=false WHERE identifier=:identifier"""), params)
        return False
    await conn.execute(text("""INSERT INTO legislative_items (id, title, identifier, institution, stage, documents, status_history, is_simulated, bill_house, bill_number, bill_year, source_url, source_file_ref, source_updated_at, source_status, committee_id) VALUES (:id,:title,:identifier,:institution,:stage,CAST(:documents AS jsonb),CAST(:status_history AS json),false,:bill_house,:bill_number,:bill_year,:source_url,:source_file_ref,:source_updated_at,:source_status,:committee_id)"""), {**params, "id": uuid.uuid4()})
    if committee_id:
        await conn.execute(text("UPDATE legislative_items SET committee_assignment_source='official record' WHERE identifier=:identifier"), {"identifier": row.identifier})
    return True


async def upsert_bills(conn, rows: list[BillRow], as_at: date) -> tuple[int, int]:
    """Returns (new_count, skipped_count). One savepoint per row."""
    new = skipped = 0
    for row in rows:
        reason = validate_bill(row)
        if reason:
            skipped += 1
            log.warning("Skipping bill %r: %s", row.identifier, reason)
            continue
        try:
            async with conn.begin_nested():
                if await _upsert_bill(conn, row, as_at):
                    new += 1
        except SQLAlchemyError as exc:
            skipped += 1
            log.error("DB error for bill %r: %s", row.identifier, exc)
    return new, skipped


# --------------------------------------------------------------------------
# Notices
# --------------------------------------------------------------------------
async def _notice_bill(conn, notice: NoticeRow):
    """The bill a notice is about: by official number, or by title when the notice gives no number."""
    if notice.bill_number is not None:
        return (await conn.execute(text(
            "SELECT id FROM legislative_items WHERE bill_house=:house AND bill_number=:number AND bill_year=:year ORDER BY id LIMIT 1"),
            {"house": notice.bill_house, "number": notice.bill_number, "year": notice.bill_year})).first()
    wanted = canonical_title(notice.bill_title)
    rows = (await conn.execute(text(
        "SELECT id, title FROM legislative_items WHERE bill_house=:house AND bill_year=:year AND is_simulated=false"),
        {"house": notice.bill_house, "year": notice.bill_year})).fetchall()
    matches = [row for row in rows if wanted and canonical_title(row[1]) == wanted]
    return (matches[0][0],) if len(matches) == 1 else None


async def _upsert_notice(conn, notice: NoticeRow):
    bill = await _notice_bill(conn, notice)
    committee_id = await ensure_committee_id(conn, notice.committee_name)
    if not bill:
        identifier = f"{notice.bill_house.upper()}/{notice.bill_year}/Notice-{hashlib.sha1(notice.bill_title.lower().encode()).hexdigest()[:10]}"
        await conn.execute(text("""INSERT INTO legislative_items (id,title,identifier,institution,stage,documents,status_history,is_simulated,bill_house,bill_number,bill_year,source_url,source_status,committee_id) VALUES (:id,:title,:identifier,'National Assembly','Public participation',CAST(:documents AS jsonb),'[]'::jsonb,false,:house,:number,:year,:source_url,'Public participation',:committee_id) ON CONFLICT (identifier) DO NOTHING"""), {"id": uuid.uuid4(), "title": notice.bill_title[:500], "identifier": identifier, "documents": json.dumps([{"name": "Memoranda notice", "url": notice.source_url}]), "house": notice.bill_house, "number": notice.bill_number, "year": notice.bill_year, "source_url": notice.source_url, "committee_id": committee_id})
        bill = (await conn.execute(text("SELECT id FROM legislative_items WHERE identifier=:identifier"), {"identifier": identifier})).first()
    if bill and committee_id:
        # Only attach a bill when its official house/number/year reference matched above.
        await conn.execute(text("UPDATE legislative_items SET committee_assignment_source=CASE WHEN committee_id IS NULL OR committee_assignment_source='subject matter' THEN 'official record' ELSE committee_assignment_source END, committee_id=CASE WHEN committee_id IS NULL OR committee_assignment_source='subject matter' THEN CAST(:committee_id AS uuid) ELSE committee_id END WHERE id=:id AND is_simulated=false"), {"id": bill[0], "committee_id": committee_id})

    if bill:
        for document_url in notice.document_urls:
            await merge_bill_document(conn, bill[0], "Official bill document (Parliament PDF)", document_url)
    await conn.execute(text("""INSERT INTO notice_records (id,bill_ref,institution,notice_date,window_start,window_end,mode,bill_text_accessible,source_url,source_title,committee_name,published_date) VALUES (:id,:bill,'National Assembly',:notice_date,:notice_date,:deadline,:mode,:accessible,:source_url,:title,:committee,:published) ON CONFLICT (source_url, bill_ref) WHERE source_url IS NOT NULL DO UPDATE SET notice_date=EXCLUDED.notice_date, window_start=EXCLUDED.window_start, window_end=EXCLUDED.window_end, mode=EXCLUDED.mode, bill_text_accessible=EXCLUDED.bill_text_accessible, source_title=EXCLUDED.source_title, committee_name=EXCLUDED.committee_name, published_date=EXCLUDED.published_date"""), {"id": uuid.uuid4(), "bill": bill[0], "notice_date": notice.notice_date, "deadline": notice.deadline, "mode": "Parliament website notice", "accessible": bool(notice.document_urls), "source_url": notice.source_url, "title": notice.title, "committee": notice.committee_name, "published": notice.notice_date})
    return bill[0] if bill else None


async def upsert_notices(conn, notices: list[NoticeRow]) -> int:
    done = 0
    bills_by_page: dict[str, list] = {}
    for notice in notices:
        try:
            async with conn.begin_nested():
                bill_id = await _upsert_notice(conn, notice)
            if bill_id:
                bills_by_page.setdefault(notice.source_url, []).append(bill_id)
            done += 1
        except SQLAlchemyError as exc:
            log.error("DB error for notice %s (%r): %s", notice.source_url, notice.bill_title, exc)
    # A re-parsed page may now name different bills: drop rows for bills it no longer names.
    for source_url, bill_ids in bills_by_page.items():
        await conn.execute(
            text("DELETE FROM notice_records WHERE source_url=:url AND NOT (bill_ref = ANY(:bills))"),
            {"url": source_url, "bills": bill_ids},
        )
    return done


async def sync_participation_stages(conn, today: date) -> tuple[int, int]:
    """Put bills at "Public participation" exactly while their call for memoranda is open.

    Returns (opened, moved_on). Only Parliament bills are touched; county
    assemblies and clerk-entered stages are left as they are.
    """
    from app.participation import stage_from_notices
    rows = (await conn.execute(text(
        "SELECT l.id, l.stage, l.source_status, l.status_history, "
        "COALESCE(json_agg(json_build_object('window_start', n.window_start, 'window_end', n.window_end)) FILTER (WHERE n.id IS NOT NULL), '[]') AS notices "
        "FROM legislative_items l LEFT JOIN notice_records n ON n.bill_ref = l.id "
        "WHERE l.institution = 'National Assembly' AND l.is_simulated = false "
        "GROUP BY l.id"))).fetchall()
    opened = moved = 0
    for row in rows:
        notices = row.notices if isinstance(row.notices, list) else json.loads(row.notices)
        new_stage = stage_from_notices(row.stage, notices, today, row.source_status)
        if not new_stage:
            continue
        history = list(row.status_history or [])
        if new_stage == "Public participation":
            closes = max(n["window_end"] for n in notices if n["window_start"] <= today.isoformat() <= n["window_end"])
            note = f"The committee's call for memoranda is open until {date.fromisoformat(closes).strftime('%d %B %Y')}."
            opened += 1
        else:
            note = "The committee's call for memoranda has ended." if new_stage != "Awaiting public participation" else "The committee has published a call for memoranda that opens later."
            moved += 1
        if not history or history[-1].get("stage") != new_stage:
            history.append({"date": today.isoformat(), "stage": new_stage, "note": note})
        await conn.execute(
            text("UPDATE legislative_items SET stage=:stage, status_history=CAST(:history AS json) WHERE id=:id"),
            {"stage": new_stage, "history": json.dumps(history), "id": row.id},
        )
    return opened, moved


# --------------------------------------------------------------------------
# Bill texts
# --------------------------------------------------------------------------
# Parliament's Bills pages list each published bill with its PDF. The trackers
# give a bill's stage but not its text, so citizens could not read most bills.
BILL_LIST_PAGES = (
    f"{BASE}/the-national-assembly/house-business/bills",
    f"{BASE}/the-senate/house-business/bills",
)
BILL_LIST_PARLIAMENTS = ("2022", "2017")
BILL_LIST_MAX_PAGES = 40
BILL_TEXT_NAME = "Official bill document (Parliament PDF)"
BILL_TEXT_REF_RE = re.compile(r"\([^)]*\bno\.?\s*\d+\.?\s*of\b[^)]*\)|,?\s*no\.?\s*\d+\.?\s*of\s+20\d{2}|\.pdf$", re.I)
NOT_A_BILL_TEXT_RE = re.compile(r"digest|order\s+paper|hansard|tracker|memorand|report\s+of|votes\s+and\s+proceedings|gazette\s+notice", re.I)


@dataclass(frozen=True)
class BillText:
    title: str
    url: str
    house: str | None
    number: int | None
    year: int | None
    name: str = BILL_TEXT_NAME


def parse_bill_list(html: str, page_url: str) -> list[BillText]:
    """Bill PDFs on one page of Parliament's Bills listing."""
    found = []
    for a in BeautifulSoup(html, "lxml").select(".post-title a[href]"):
        url = urljoin(page_url, a["href"])
        title = clean(a.get_text(" ", strip=True))
        if not PDF_RE.search(url) or not re.search(r"\bbill\b", title, re.I) or NOT_A_BILL_TEXT_RE.search(title):
            continue
        ref = BILL_REF_RE.search(title)
        generic = None if ref else GENERIC_BILL_REF_RE.search(title)
        year = YEAR_RE.search(title)
        found.append(BillText(
            title=title, url=url,
            house=canonical_house(ref.group("house")) if ref else None,
            number=int(ref.group("number")) if ref else (int(generic.group(1)) if generic else None),
            year=int(ref.group("year")) if ref else (int(generic.group(2)) if generic else (int(year.group(1)) if year else None)),
        ))
    return found


async def fetch_bill_texts() -> list[BillText]:
    """Every bill PDF on Parliament's National Assembly and Senate Bills pages, newest first."""
    texts: list[BillText] = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        for base in BILL_LIST_PAGES:
            for parliament in BILL_LIST_PARLIAMENTS:
                for page in range(BILL_LIST_MAX_PAGES):
                    url = f"{base}?title=%20&field_parliament_value={parliament}&page={page}"
                    try:
                        rows = parse_bill_list((await get(client, url)).text, url)
                    except httpx.HTTPError as exc:
                        log.warning("Bills page unavailable %s: %s", url, exc)
                        break
                    if not rows:
                        break
                    texts.extend(rows)
                    await asyncio.sleep(POLITE_DELAY_S)
    return list({text_row.url: text_row for text_row in texts}.values())


async def attach_bill_texts(conn, texts: list[BillText]) -> int:
    """Link each Parliament bill to its published text. Returns how many bills gained one."""
    bills = (await conn.execute(text(
        "SELECT id, title, bill_house, bill_number, bill_year, documents FROM legislative_items "
        "WHERE institution='National Assembly' AND is_simulated=false"))).fetchall()
    by_ref = {(row.bill_house, row.bill_number, row.bill_year): row for row in bills if row.bill_number is not None}
    by_title: dict[tuple, list] = {}
    for row in bills:
        by_title.setdefault((canonical_title(row.title), row.bill_year), []).append(row)
    has_text = {row.id for row in bills if any(isinstance(d, dict) and d.get("name") == BILL_TEXT_NAME for d in (row.documents or []))}
    added = 0
    for item in texts:
        bill = by_ref.get((item.house, item.number, item.year)) if item.house and item.number else None
        if bill is None:
            # Titles are written many ways ("BILL,2026", "Bill, 2026 (National Assembly Bills No. 17 of 2025)",
            # "Bill, No.45 of 2023"): drop the bill reference but keep "(Amendment)" and "(No. 2)".
            name = BILL_TEXT_REF_RE.sub(" ", item.title)
            matches = by_title.get((canonical_title(name), item.year), [])
            # Several rows with one title and year are the same bill (a proposal and the published bill).
            for match in matches:
                if match.id not in has_text:
                    await merge_bill_document(conn, match.id, item.name or BILL_TEXT_NAME, item.url)
                    has_text.add(match.id)
                    added += 1
            continue
        if bill.id in has_text:
            continue
        await merge_bill_document(conn, bill.id, item.name or BILL_TEXT_NAME, item.url)
        has_text.add(bill.id)
        added += 1
    return added


async def titles_with_text(conn) -> set[tuple[str, int | None]]:
    rows = (await conn.execute(text("SELECT title, bill_year, documents FROM legislative_items WHERE is_simulated=false"))).all()
    return {(canonical_title(r.title), r.bill_year) for r in rows
            if any(isinstance(d, dict) and str(d.get("name", "")).startswith("Official bill document") for d in (r.documents or []))}


# Mzalendo (mzalendo.com, a Kenyan parliamentary monitor) lists 13th-Parliament bills with the
# official bill number and a link to Parliament's PDF, including PDFs missing from Parliament's own
# Bills pages. Its CSV export and bill pages are public; we read them slowly.
MZALENDO = "https://mzalendo.com"
MZALENDO_BILLS_CSV = f"{MZALENDO}/legislative-trends/bills/?year=&house=&stage=&q=&format=csv"
MZALENDO_COPY_NAME = "Official bill document (Parliament PDF, copy kept by Mzalendo)"


def parse_mzalendo_bill_page(html: str, title: str, year: int | None) -> BillText | None:
    """The official reference and PDF link on one Mzalendo bill page."""
    soup = BeautifulSoup(html, "lxml")
    identifier, pdf = None, None
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
        except ValueError:
            continue
        for node in (data.get("@graph", [data]) if isinstance(data, dict) else []):
            if isinstance(node, dict) and node.get("legislationIdentifier"):
                identifier = identifier or node.get("legislationIdentifier")
                based = node.get("isBasedOn")
                if isinstance(based, str) and PDF_RE.search(based):
                    pdf = pdf or based
    links = [a["href"] for a in soup.select("a[href]") if PDF_RE.search(a["href"])]
    pdf = pdf or next((h for h in links if (urlparse(h).hostname or "").endswith("parliament.go.ke")), None)
    name = BILL_TEXT_NAME
    if not pdf:
        pdf = next((h for h in links if "mzdocs" in h), None)
        name = MZALENDO_COPY_NAME
    if not pdf:
        return None
    ref = BILL_TRACKER_REF_RE.search(identifier or "") or BILL_REF_RE.search(identifier or "")
    return BillText(title=title, url=pdf, house=canonical_house(ref.group("house")) if ref else None,
                    number=int(ref.group("number")) if ref else None,
                    year=int(ref.group("year")) if ref else year, name=name)


async def fetch_mzalendo_bill_texts(skip_titles: set[tuple[str, int | None]] = frozenset()) -> list[BillText]:
    """Bill PDFs from Mzalendo's bill tracker, skipping bills whose text the platform already has."""
    import csv
    import io
    texts: list[BillText] = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        rows = list(csv.DictReader(io.StringIO((await get(client, MZALENDO_BILLS_CSV)).text)))
        for row in rows:
            year = int(row["Year"]) if (row.get("Year") or "").isdigit() else None
            title = clean(row.get("Bill") or "")
            if not row.get("URL") or (canonical_title(title), year) in skip_titles:
                continue
            try:
                found = parse_mzalendo_bill_page((await get(client, row["URL"])).text, title, year)
            except httpx.HTTPError as exc:
                log.warning("Mzalendo bill page unavailable %s: %s", row["URL"], exc)
                continue
            if found:
                if not found.house:
                    found = replace(found, house=canonical_house(row.get("House")))
                texts.append(found)
            await asyncio.sleep(POLITE_DELAY_S * 2)
    return texts


# --------------------------------------------------------------------------
# Linking committee reports to their bill
# --------------------------------------------------------------------------
REPORT_BILL_WORD_RE = re.compile(r"\bbills?\b", re.I)
REPORT_BILL_YEAR_RE = re.compile(
    r"^[\s,.(-]*(?:(?:national\s+assembly|senate|sen|n\.?a)\.?\s*)?(?:bills?\s*)?(?:no\.?\s*\d+\s*(?:,|of)?\s*)?(20\d{2})\b", re.I)
# References report titles write that BILL_REF_RE misses: "(Senate No. 30 of 2024)", "Sen. Bill No. 1 of 2025".
SHORT_BILL_REF_RE = re.compile(
    r"\b(?P<house>national\s+assembly|senate|sen|n\.?a)\.?\s*(?:bills?\s*)?no\.?\s*(?P<number>\d+)\s*(?:,|of)?\s*(?P<year>20\d{2})\b", re.I)
NAME_DROP_WORDS = {"bill", "bills", "no", "national", "assembly", "senate"}
NAME_GLUE_WORDS = {"the", "of"}


def _name_words(value: str) -> list[str]:
    """A bill name as comparable words, with the abbreviations and spellings report titles use unified.

    "the" and "of" are kept so a match can see where a name starts; compare names with _compact.
    """
    value = clean(value).lower().replace("&", " and ")
    value = re.sub(r"\(\s*a\s*\)", " amendment ", value)
    value = re.sub(r"\b(?:amdnt|amdt|ammendment|amendments)\b", "amendment", value)
    value = re.sub(r"\.pdf\b|\bcompressed\b|_", " ", value)
    value = re.sub(r"(\w)iz(e|es|ed|ation|ing)\b", r"\1is\2", value)  # equalization -> equalisation
    value = re.sub(r"(?<=[a-z])-\s*(?=[a-z])", "", value)  # co-ordination, Anti- Money -> one word
    return [w for w in re.findall(r"[a-z0-9]+", value) if w not in NAME_DROP_WORDS and not re.fullmatch(r"20\d{2}", w)]


def _compact(words: list[str]) -> str:
    return "".join(w for w in words if w not in NAME_GLUE_WORDS)


# Words that can come just before a bill's name in a report title ("Report on the ...",
# "...on its consideration of the ..."). A name must start after one of these, so the
# "Appropriation Bill" does not match a report on the "Equalisation Fund Appropriation Bill".
NAME_LEAD_WORDS = {"on", "to", "report", "consideration", "its", "into", "for", "regarding", "re", "memo",
                   "memorandum", "addendum", "tabled", "final", "in", "referral", "amendments", "amendment",
                   "about", "version", "the"}


def name_matches(words: list[str], bill_words: list[str]) -> bool:
    """True when a report title's words before "Bill" end with exactly this bill's name."""
    target = _compact(bill_words)
    if not target:
        return False
    for k, word in enumerate(words):
        if word in NAME_GLUE_WORDS or _compact(words[k:]) != target:
            continue
        before = words[k - 1] if k else None
        if before == "of":  # "consideration of X" yes, "Division of X" no
            before = words[k - 2] if k > 1 else None
            return before is None or (before in NAME_LEAD_WORDS and before != "the")
        return before is None or before in NAME_LEAD_WORDS
    return False


def report_bill_reference(title: str) -> tuple[list[str], int | None]:
    """What a report title says about its bill: the words before "Bill", and the bill's year."""
    match = REPORT_BILL_WORD_RE.search(title or "")
    if not match:
        return [], None
    year = REPORT_BILL_YEAR_RE.search(title[match.end():])
    return _name_words(title[:match.start()]), int(year.group(1)) if year else None


def _bill_name_words(title: str) -> list[str]:
    """A bill row's name, ignoring anything the tracker appended after "Bill"."""
    return report_bill_reference(title)[0] or _name_words(title)


def _prefer_published(rows: list) -> list:
    published = [row for row in rows if "/Proposal-" not in row.identifier and "/Notice-" not in row.identifier]
    return published or rows


async def resolve_report_bill(conn, row: dict):
    """The bill a committee report is about, or None when the title does not say so unambiguously.

    1. The official reference ("NA Bill No. 15 of 2026"), or a number and year found in one house only.
    2. The bill's exact name and year as the title writes them ("...on the Insurance (Amendment) Bill, 2019").
       Near matches are not linked here; they wait for a person in legislative_link_reviews.
    """
    house, number, year = canonical_house(row.get("bill_house")), row.get("bill_number"), row.get("bill_year")
    title = row.get("title") or ""
    short = None if (house and number) else SHORT_BILL_REF_RE.search(title)
    if short:
        house, number, year = canonical_house(short.group("house")) or ("na" if short.group("house").lower().startswith("n") else None), int(short.group("number")), int(short.group("year"))
    if number and year:
        found = (await conn.execute(text(
            "SELECT id, identifier, title FROM legislative_items WHERE is_simulated=false AND bill_number=:number AND bill_year=:year"
            + (" AND bill_house=:house" if house else " AND bill_house IN ('na','senate')")),
            {"number": number, "year": year, "house": house})).all()
        if not house:
            # A number with no house could be either house's bill: the names must agree too.
            words = _compact(report_bill_reference(title)[0])
            found = [f for f in found if not words or partial_ratio(_compact(_bill_name_words(f.title)), words) >= 80]
        if len(found) == 1:
            return found[0].id
    words, name_year = report_bill_reference(title)
    if not words:
        return None
    years = [name_year or year] if (name_year or year) else []
    if not years and row.get("date_tabled"):
        tabled = row["date_tabled"].year
        years = [tabled, tabled - 1, tabled - 2]
    if not years:
        return None
    bills = (await conn.execute(text(
        "SELECT id, identifier, title, bill_year FROM legislative_items WHERE is_simulated=false "
        "AND bill_house IN ('na','senate') AND bill_year = ANY(:years)"), {"years": years})).all()
    best, best_len = [], 0
    for bill in bills:
        bill_words = _bill_name_words(bill.title)
        if name_matches(words, bill_words):
            size = len(_compact(bill_words))
            if size > best_len:
                best, best_len = [bill], size
            elif size == best_len:
                best.append(bill)
    best = _prefer_published(best)
    # Rows with one name and year are copies of one bill (a proposal and the published bill).
    if len({(_compact(_bill_name_words(b.title)), b.bill_year) for b in best}) != 1:
        return None
    return min(best, key=lambda b: (len(b.title), b.identifier)).id


async def link_unlinked_reports(conn) -> int:
    """Link committee reports that have no bill yet. Returns how many were linked."""
    rows = (await conn.execute(text(
        "SELECT id, title, bill_house, bill_number, bill_year, date_tabled FROM committee_reports "
        "WHERE bill_ref IS NULL AND is_simulated=false "
        "AND (bill_house IS NULL OR bill_house NOT IN ('ncca', 'tnca'))"))).mappings().all()  # county reports link in sync_county_bills
    linked = 0
    for row in rows:
        bill_id = await resolve_report_bill(conn, dict(row))
        if bill_id:
            await conn.execute(text("UPDATE committee_reports SET bill_ref=:bill WHERE id=:id AND bill_ref IS NULL"),
                               {"bill": bill_id, "id": row["id"]})
            linked += 1
    return linked


# --------------------------------------------------------------------------
# Committee reports
# --------------------------------------------------------------------------
async def _upsert_report(conn, row: dict) -> bool:
    """Insert or update one report. Returns True if a new row was inserted."""
    is_new = False
    bill_id = await resolve_report_bill(conn, row)
    existing = (await conn.execute(text("SELECT id FROM committee_reports WHERE source_url=:source_url AND committee_url=:committee_url"), {"source_url": row["source_url"], "committee_url": row["committee_url"]})).first()
    params = {**row, "bill_ref": bill_id, "source_document_ref": row["source_url"], "date_tabled": row["date_tabled"] or date.today(), "extraction_status": "pending", "ocr_used": False, "is_simulated": False}
    if existing:
        await conn.execute(text("""UPDATE committee_reports SET bill_ref=COALESCE(:bill_ref, bill_ref),institution=:institution,date_tabled=:date_tabled,source_document_ref=:source_document_ref,committee_name=:committee_name,committee_url=:committee_url,title=:title,bill_house=:bill_house,bill_number=:bill_number,bill_year=:bill_year,source_url=:source_url,is_simulated=false WHERE id=:id"""), {**params, "id": existing[0]})
        report_id = existing[0]
    else:
        report_id = uuid.uuid4()
        await conn.execute(text("""INSERT INTO committee_reports (id,bill_ref,institution,date_tabled,source_document_ref,extraction_status,ocr_used,is_simulated,committee_name,committee_url,title,bill_house,bill_number,bill_year,source_url) VALUES (:id,:bill_ref,:institution,:date_tabled,:source_document_ref,:extraction_status,:ocr_used,:is_simulated,:committee_name,:committee_url,:title,:bill_house,:bill_number,:bill_year,:source_url)"""), {**params, "id": report_id})
        is_new = True
    if bill_id is None:
        bills = (await conn.execute(text("SELECT id,title FROM legislative_items WHERE bill_house=:house AND bill_year=:year"), {"house": row["bill_house"] or "na", "year": row["bill_year"] or (row["date_tabled"].year if row["date_tabled"] else date.today().year)})).all()
        report_title = canonical_title(row["title"])
        ranked = sorted(((ratio(report_title, canonical_title(b[1])) / 100, b[0], b[1]) for b in bills), reverse=True)[:3]
        for score, candidate_id, candidate_title in ranked:
            if score < 0.70:
                continue
            await conn.execute(text("""INSERT INTO legislative_link_reviews (report_ref,candidate_bill_ref,match_method,confidence_score,explanation) VALUES (:report,:bill,'title-review',:score,:explanation) ON CONFLICT (report_ref,candidate_bill_ref) DO UPDATE SET confidence_score=EXCLUDED.confidence_score,explanation=EXCLUDED.explanation"""), {"report": report_id, "bill": candidate_id, "score": score, "explanation": f"Title-only candidate requires human confirmation. Report: {row['title']}; candidate: {candidate_title}."})
    return is_new


async def upsert_reports(conn, rows: list[dict]) -> int:
    committee_candidates: dict[tuple[str, int, int], dict[str, str]] = {}
    for row in rows:
        if not (row.get("bill_house") and row.get("bill_number") and row.get("bill_year") and row.get("committee_name")):
            continue
        reference = (canonical_house(row["bill_house"]) or "na", int(row["bill_number"]), int(row["bill_year"]))
        committee_candidates.setdefault(reference, {})[committee_key(row["committee_name"])] = row["committee_name"]

    # Apply only a consensus referral from exact official report references.
    # Multiple reports on a bill can be legitimate, so conflicting committees
    # are left for a clerk rather than selecting the last scraped page.
    for (house, number, year), candidates in committee_candidates.items():
        if len(candidates) != 1:
            if candidates:
                log.warning("Conflicting official committee reports for %s/%s/%s: %s", house, year, number, sorted(candidates.values()))
            continue
        committee_id = await ensure_committee_id(conn, next(iter(candidates.values())))
        if not committee_id:
            continue
        bill = (await conn.execute(text("SELECT id FROM legislative_items WHERE bill_house=:house AND bill_number=:number AND bill_year=:year ORDER BY id LIMIT 1"), {"house": house, "number": number, "year": year})).first()
        if bill:
            await conn.execute(text("UPDATE legislative_items SET committee_id=:committee_id WHERE id=:id AND is_simulated=false"), {"id": bill[0], "committee_id": committee_id})

    count = 0
    for row in rows:
        try:
            async with conn.begin_nested():
                if await _upsert_report(conn, row):
                    count += 1
        except SQLAlchemyError as exc:
            log.error("DB error for report %s: %s", row.get("source_url"), exc)
    return count


async def fetch_all() -> tuple[list[BillRow], list[NoticeRow], list[dict], int, int]:
    async with httpx.AsyncClient(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        nav = await get(client, COMMITTEES_INDEX)
        committees = discover_committees(nav.text)
        if len(committees) < MIN_COMMITTEES:
            raise RuntimeError(f"Only {len(committees)} committees discovered; refusing a partial report sync")

        tracker_page = await get(client, TRACKER_INDEX)
        tracker_url, tracker_date = choose_latest_tracker(tracker_page.text)
        tracker_text = extract_pdf((await get(client, tracker_url)).content)
        bills = parse_tracker(tracker_text, tracker_url, tracker_date, [committee.name for committee in committees])

        bill_tracker_page = await get(client, BILL_TRACKER_INDEX)
        bill_tracker_url, bill_tracker_date = choose_latest_tracker(bill_tracker_page.text, BILL_TRACKER_INDEX)
        bill_tracker_pdf = (await get(client, bill_tracker_url)).content
        bill_tracker_text = extract_pdf(bill_tracker_pdf, layout=False)
        bill_tracker_layout = extract_pdf(bill_tracker_pdf, layout=True)
        stage_rows = parse_bill_stage_tracker(
            bill_tracker_text,
            bill_tracker_url,
            bill_tracker_date,
            bill_tracker_layout,
            [committee.name for committee in committees],
        )
        if len(stage_rows) < 10:
            raise RuntimeError(f"Only {len(stage_rows)} explicit bill stages parsed from the official Bills Tracker; refusing a partial stage sync")
        bills = merge_bill_stage_rows(bills, stage_rows)
        log.info("Parsed %d explicit bill stages from Parliament Bills Tracker as at %s", len(stage_rows), bill_tracker_date)
        log.info("Applied current-stage data to %d existing platform bills", sum(row.stage_source_url == bill_tracker_url for row in bills))

        notice_urls = await discover_notice_pages(client)
        log.info("Found %d call-for-memoranda pages", len(notice_urls))
        notices: list[NoticeRow] = []
        for url in notice_urls:
            try:
                page = await get(client, url)
            except httpx.HTTPError as exc:
                log.warning("Notice page unavailable %s: %s", url, exc)
                continue
            page_soup = BeautifulSoup(page.text, "lxml")
            attachment = next((urljoin(url, a["href"]) for a in page_soup.select("article a[href]") if PDF_RE.search(a["href"])), None)
            try:
                attachment_text = extract_pdf((await get(client, attachment)).content) if attachment else ""
            except (httpx.HTTPError, RuntimeError) as exc:
                log.warning("Notice attachment unreadable %s: %s", attachment, exc)
                attachment_text = ""
            notices.extend(parse_notice_page(page.text, url, attachment_text))

        sem = asyncio.Semaphore(CONCURRENCY)
        async def one(committee: Committee):
            async with sem:
                try:
                    rows = parse_reports((await get(client, committee.url)).text, committee)
                    await asyncio.sleep(POLITE_DELAY_S)
                    return rows
                except Exception as exc:
                    log.error("Committee %s failed: %s", committee.name, exc)
                    return None
        results = await asyncio.gather(*(one(c) for c in committees))
        failed = sum(r is None for r in results)
        reports = [row for result in results if result for row in result]
        return bills, notices, reports, len(committees), failed


async def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        log.error("DATABASE_URL is not set")
        return 1
    bills, notices, reports, committee_count, failed = await fetch_all()
    try:
        bill_texts = await fetch_bill_texts()
    except Exception as exc:  # bill texts are a bonus; never block the stage sync
        log.warning("Could not read Parliament's Bills pages: %s", exc)
        bill_texts = []
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            for statement in filter(None, (s.strip() for s in SCHEMA_SQL.split(";"))):
                await conn.execute(text(statement))
            new_bills, skipped_bills = await upsert_bills(conn, bills, date.today())
            notice_count = await upsert_notices(conn, notices)
            opened, moved_on = await sync_participation_stages(conn, date.today())
            log.info("Bill texts: %d found on Parliament's Bills pages, %d newly linked", len(bill_texts), await attach_bill_texts(conn, bill_texts))
            try:
                mzalendo_texts = await fetch_mzalendo_bill_texts(await titles_with_text(conn))
                log.info("Bill texts: %d more from Mzalendo, %d newly linked", len(mzalendo_texts), await attach_bill_texts(conn, mzalendo_texts))
            except Exception as exc:  # a bonus source; never block the sync
                log.warning("Could not read Mzalendo's bill tracker: %s", exc)
            log.info("Public participation: %d bill(s) open now, %d moved on after their call closed", opened, moved_on)
            new_reports = await upsert_reports(conn, reports)
            log.info("Committee reports: %d more linked to their bill by name", await link_unlinked_reports(conn))
            # County assemblies (Nairobi, Trans Nzoia). A county failure is logged, not fatal.
            from app.scripts.sync_county_bills import sync_counties
            county_results = await sync_counties(conn)
            log.info("County sync: %s", {name: result for name, result in county_results.items()})
            # Committees for bills no official source assigns (see app.committee_assignment).
            from app.committee_assignment import assign_committees
            await assign_committees(conn)
            log.info(
                "Synced %d bills (%d new, %d skipped), %d notice-bill rows, %d reports (%d new), %d/%d committees failed",
                len(bills), new_bills, skipped_bills, notice_count, len(reports), new_reports, failed, committee_count,
            )
    finally:
        await engine.dispose()

    # Data is committed above; a non-zero exit just makes CI (and the
    # failure-issue step) flag a run where too much was skipped or failed.
    too_many_committee_failures = failed / committee_count > MAX_FAILED_FRACTION
    too_many_bill_skips = bool(bills) and skipped_bills / len(bills) > MAX_FAILED_FRACTION
    if too_many_bill_skips:
        log.error("%d of %d bills were skipped; check the tracker parser", skipped_bills, len(bills))
    return 1 if (too_many_committee_failures or too_many_bill_skips) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
