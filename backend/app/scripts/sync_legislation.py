"""Sync Kenya Parliament legislation into Participation Trace.

Run from ``backend/``::

    python -m app.scripts.sync_legislation

The Parliament's legislative-proposals page publishes tracker PDFs rather than
HTML rows.  This sync discovers the newest tracker PDF, extracts its fixed-width
text with ``pdftotext``, and upserts the platform's existing
``legislative_items`` rows.  It also discovers the live Submission of Memoranda
page from the committee navigation, parses each notice, and upserts notices.

Committee report ingestion keeps the report PDF URL as the verifiable endpoint.
A report is linked to a bill automatically only when the normalized
(house, number, year) key agrees.  A title-only/numberless report is never
silently attached: candidates are written to ``legislative_link_reviews`` for
human confirmation.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from rapidfuzz.fuzz import ratio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sync_legislation")

BASE = "https://www.parliament.go.ke"
COMMITTEES_INDEX = f"{BASE}/the-national-assembly/committees"
TRACKER_INDEX = f"{BASE}/legislative-proposals-tracker"
MEMORANDA_INDEX = f"{BASE}/submission-memoranda"
HEADERS = {"User-Agent": "DiraLegislationSync/1.0 (civic-tech research; non-commercial)"}
CONCURRENCY = 4
POLITE_DELAY_S = 0.35
MIN_COMMITTEES = 20
MAX_FAILED_FRACTION = 0.25
PDF_RE = re.compile(r"\.pdf(?:$|[?#])", re.I)
MONTH_RE = re.compile(r"/sites/default/files/(\d{4})-(\d{2})/")
BILL_REF_RE = re.compile(
    r"\b(?P<house>national\s+assembly|na|senate)\s*bill\s*(?:no\.?\s*)?(?P<number>\d+)\s*(?:of\s+)?(?:[A-Za-z]+\s+){0,3}(?P<year>20\d{2})\b",
    re.I,
)
GENERIC_BILL_REF_RE = re.compile(r"\bbill\s*(?:no\.?\s*)?(\d+)\s*(?:of\s+)?(?:[A-Za-z]+\s+){0,3}(20\d{2})\b", re.I)
TRACKER_BILL_HEAD_RE = re.compile(r"\b(?P<house>national\s+assembly|na|senate)\s*bill\s*(?:no\.?\s*)?(?P<number>\d+)\b", re.I)
YEAR_RE = re.compile(r"\b(20\d{2})\b")
DATE_RE = re.compile(
    r"\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+"
    r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b",
    re.I,
)

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
    value = value.lower()
    if "senate" in value:
        return "senate"
    if value in {"na", "national assembly"} or "national assembly" in value:
        return "na"
    return None


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


def choose_latest_tracker(html: str) -> tuple[str, date]:
    links = pdf_links(html, TRACKER_INDEX)
    tracker_links = [(u, l) for u, l in links if "tracker" in f"{u} {l}".lower()]
    if not tracker_links:
        raise RuntimeError("The official tracker page contained no tracker PDF links")
    href, label = max(tracker_links, key=lambda item: link_date(*item))
    return href, link_date(href, label)


def extract_pdf(pdf_bytes: bytes) -> str:
    with tempfile.TemporaryDirectory(prefix="legsync-") as directory:
        pdf = Path(directory) / "source.pdf"
        txt = Path(directory) / "source.txt"
        pdf.write_bytes(pdf_bytes)
        try:
            subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True, capture_output=True, text=True)
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
            if "LEGISLATIVE PROPOSALS TRACKER" not in line and not line.strip().startswith("S. NO"):
                block.append(line)
    if block:
        yield block


def parse_tracker(text_value: str, source_url: str, as_at: date) -> list[BillRow]:
    rows: list[BillRow] = []
    for block in _row_blocks(text_value):
        joined = clean(" ".join(block))
        ref = BILL_REF_RE.search(joined)
        tracker_head = TRACKER_BILL_HEAD_RE.search(joined)
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

        # pdftotext preserves the tracker columns. The title cell begins at
        # column 30 and ends before the sponsor cell at column 78.
        title_parts = []
        for line in block:
            if len(line) > 30:
                piece = line[30:78]
                piece = re.sub(r"\b(?:Hon\.|Dr\.|Prof\.|Sen\.|Ms\.)\s*.*", "", piece, flags=re.I)
                piece = re.sub(r"\b(?:Chairperson|Member|Governor)\b\s*.*", "", piece, flags=re.I)
                if piece.strip():
                    title_parts.append(piece)
        title = clean(" ".join(title_parts))
        if not title or "title/subject" in title.lower():
            continue
        if not re.search(r"\b(bill|amendment|appropriation|finance|fund)\b", title, re.I):
            continue
        file_match = re.search(r"DLS\s*/\s*([^\s]+(?:\s*/\s*[^\s]+){1,})", joined, re.I)
        file_ref = clean(file_match.group(0)) if file_match else None
        suffix = f"Bill-{number:03d}" if number is not None else f"Proposal-{hashlib.sha1((file_ref or title).encode()).hexdigest()[:10]}"
        identifier = f"{house.upper()}/{year}/{suffix}"
        stage = clean(joined[joined.lower().rfind("published") :]) if "published" in joined.lower() else "Legislative proposal"
        rows.append(BillRow(title=title, identifier=identifier, house=house, number=number, year=year, stage=stage[:100], source_url=source_url, source_file_ref=file_ref))
    unique: dict[str, BillRow] = {row.identifier: row for row in rows}
    if len(unique) < 5:
        raise RuntimeError(f"Tracker parser produced only {len(unique)} bills; refusing a partial sync")
    return list(unique.values())


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
    deadline_match = re.search(r"(?:on or before|to be received[^.]{0,50}\bon or before|by)\s+(?:\w+\s*,?\s*)?(\d{1,2})\s*(?:st|nd|rd|th)?\s+(\w+)\s+(20\d{2})", source_text, re.I)
    deadline = date(int(deadline_match.group(3)), MONTHS[deadline_match.group(2).lower()], int(deadline_match.group(1))) if deadline_match and deadline_match.group(2).lower() in MONTHS else None
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
    formal_pattern = re.compile(r"(?:^|[;(])\s*(?:\(?\d+\)?[.)]\s*)?THE\s+([A-Z][A-Z0-9 &'(),./-]{2,120}?\bBILL)\s*\(\s*NATIONAL\s+ASSEMBLY\s+BILL\s+NO\.?\s*(\d+)\s+OF\s*(20\d{2})")
    for formal in formal_pattern.finditer(formal_text):
        formal_title = clean(formal.group(1))
        formal_title = re.sub(r"^(?:AND\s+\(\d+\)\s+)?THE\s+", "", formal_title, flags=re.I)
        formal_key = canonical_title(formal_title)
        if formal_key not in seen_candidate_keys:
            candidates.append(formal_title)
            seen_candidate_keys.add(formal_key)
            structured_refs[formal_title] = (int(formal.group(2)), int(formal.group(3)))
    for line in ([] if structured_refs else f"{article.get_text(chr(10), strip=True)}\n{attachment_text}".splitlines()):
        line = clean(line)
        if re.search(r"\bbill\b", line, re.I) and len(line) >= 10:
            match = re.search(r"(?:^|[;(])\s*(?:\(?\d+\)?[.)]\s*)?(?:the\s+)?([A-Za-z][A-Za-z0-9 &'’(),./-]{2,120}?\bbill)\b", line, re.I)
            candidate = clean(match.group(1)) if match else line
            candidate = re.sub(r"\s*\([^)]*(?:bill\s+no|national assembly)[^)]*\)", "", candidate, flags=re.I)
            candidate = re.sub(r"\s+20\d{2}\s*$", "", candidate)
            candidate_key = canonical_title(candidate)
            if candidate_key not in seen_candidate_keys and not candidate.lower().startswith(("invitation", "submitted by", "and whereas", "hearings", "assembly bill")):
                candidates.append(candidate)
                seen_candidate_keys.add(candidate_key)
                candidate_refs[candidate] = BILL_REF_RE.search(line) or GENERIC_BILL_REF_RE.search(line)
    if not candidates:
        candidates = [clean(soup.title.get_text(" ", strip=True))]

    rows = []
    for title in candidates:
        if title in structured_refs:
            number, year = structured_refs[title]
            house = "na"
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
    return rows


@dataclass(frozen=True)
class Committee:
    name: str
    url: str
    group: str


def discover_committees(html: str) -> list[Committee]:
    soup = BeautifulSoup(html, "lxml")
    found: dict[str, Committee] = {}
    for a in soup.select("a[href]"):
        name = clean(a.get_text(" ", strip=True))
        href = urljoin(BASE, a["href"]).split("#")[0]
        if not name or not href.startswith(BASE) or "committee" not in href.lower():
            continue
        if any(x in name.lower() for x in ("departmental committees", "audit, appropriations", "committee") ):
            found[href] = Committee(name, href, "National Assembly")
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_notice_source_url ON notice_records(source_url) WHERE source_url IS NOT NULL;
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
    return [{"name": "Legislative Proposals Tracker", "url": row.source_url}]


async def upsert_bills(conn, rows: list[BillRow], as_at: date) -> int:
    changed = 0
    for row in rows:
        result = await conn.execute(text("SELECT id FROM legislative_items WHERE identifier=:identifier"), {"identifier": row.identifier})
        exists = result.first()
        params = {"title": row.title, "identifier": row.identifier, "institution": "National Assembly", "stage": row.stage, "documents": bill_documents(row), "bill_house": row.house, "bill_number": row.number, "bill_year": row.year, "source_url": row.source_url, "source_file_ref": row.source_file_ref, "source_updated_at": as_at, "source_status": row.stage}
        if exists:
            await conn.execute(text("""UPDATE legislative_items SET title=:title, institution=:institution, stage=:stage, documents=CAST(:documents AS jsonb), bill_house=:bill_house, bill_number=:bill_number, bill_year=:bill_year, source_url=:source_url, source_file_ref=:source_file_ref, source_updated_at=:source_updated_at, source_status=:source_status, is_simulated=false WHERE identifier=:identifier"""), {**params, "documents": __import__("json").dumps(params["documents"])})
        else:
            await conn.execute(text("""INSERT INTO legislative_items (title, identifier, institution, stage, documents, status_history, is_simulated, bill_house, bill_number, bill_year, source_url, source_file_ref, source_updated_at, source_status) VALUES (:title,:identifier,:institution,:stage,CAST(:documents AS jsonb),'[]'::jsonb,false,:bill_house,:bill_number,:bill_year,:source_url,:source_file_ref,:source_updated_at,:source_status)"""), {**params, "documents": __import__("json").dumps(params["documents"])})
            changed += 1
    return changed


async def upsert_notices(conn, notices: list[NoticeRow]) -> int:
    inserted = 0
    for notice in notices:
        result = await conn.execute(text("SELECT id FROM legislative_items WHERE bill_house=:house AND bill_number IS NOT DISTINCT FROM :number AND bill_year=:year ORDER BY id LIMIT 1"), {"house": notice.bill_house, "number": notice.bill_number, "year": notice.bill_year})
        bill = result.first()
        if not bill:
            identifier = f"{notice.bill_house.upper()}/{notice.bill_year}/Notice-{hashlib.sha1(notice.bill_title.lower().encode()).hexdigest()[:10]}"
            await conn.execute(text("""INSERT INTO legislative_items (title,identifier,institution,stage,documents,status_history,is_simulated,bill_house,bill_number,bill_year,source_url,source_status) VALUES (:title,:identifier,'National Assembly','Public participation',CAST(:documents AS jsonb),'[]'::jsonb,false,:house,:number,:year,:source_url,'Public participation') ON CONFLICT (identifier) DO NOTHING"""), {"title": notice.bill_title, "identifier": identifier, "documents": __import__("json").dumps([{"name": "Memoranda notice", "url": notice.source_url}, *({"name": "Bill text", "url": u} for u in notice.document_urls)]), "house": notice.bill_house, "number": notice.bill_number, "year": notice.bill_year, "source_url": notice.source_url})
            bill = (await conn.execute(text("SELECT id FROM legislative_items WHERE identifier=:identifier"), {"identifier": identifier})).first()
        await conn.execute(text("""INSERT INTO notice_records (bill_ref,institution,notice_date,window_start,window_end,mode,bill_text_accessible,source_url,source_title,committee_name,published_date) VALUES (:bill,'National Assembly',:notice_date,:notice_date,:deadline,:mode,:accessible,:source_url,:title,:committee,:published) ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO UPDATE SET bill_ref=EXCLUDED.bill_ref, notice_date=EXCLUDED.notice_date, window_start=EXCLUDED.window_start, window_end=EXCLUDED.window_end, mode=EXCLUDED.mode, bill_text_accessible=EXCLUDED.bill_text_accessible, source_title=EXCLUDED.source_title, committee_name=EXCLUDED.committee_name, published_date=EXCLUDED.published_date"""), {"bill": bill[0], "notice_date": notice.notice_date, "deadline": notice.deadline, "mode": "Parliament website notice", "accessible": bool(notice.document_urls), "source_url": notice.source_url, "title": notice.title, "committee": notice.committee_name, "published": notice.notice_date})
        inserted += 1
    return inserted


async def upsert_reports(conn, rows: list[dict]) -> int:
    count = 0
    for row in rows:
        bill_id = None
        if row["bill_house"] and row["bill_number"] and row["bill_year"]:
            bill = await conn.execute(text("SELECT id FROM legislative_items WHERE bill_house=:house AND bill_number=:number AND bill_year=:year ORDER BY id LIMIT 1"), {"house": row["bill_house"], "number": row["bill_number"], "year": row["bill_year"]})
            found = bill.first()
            bill_id = found[0] if found else None
        existing = (await conn.execute(text("SELECT id FROM committee_reports WHERE source_url=:source_url AND committee_url=:committee_url"), row)).first()
        params = {**row, "bill_ref": bill_id, "source_document_ref": row["source_url"], "date_tabled": row["date_tabled"] or date.today(), "extraction_status": "pending", "ocr_used": False, "is_simulated": False}
        if existing:
            await conn.execute(text("""UPDATE committee_reports SET bill_ref=:bill_ref,institution=:institution,date_tabled=:date_tabled,source_document_ref=:source_document_ref,committee_name=:committee_name,committee_url=:committee_url,title=:title,bill_house=:bill_house,bill_number=:bill_number,bill_year=:bill_year,source_url=:source_url,is_simulated=false WHERE id=:id"""), {**params, "id": existing[0]})
            report_id = existing[0]
        else:
            report_id = (await conn.execute(text("""INSERT INTO committee_reports (bill_ref,institution,date_tabled,source_document_ref,extraction_status,ocr_used,is_simulated,committee_name,committee_url,title,bill_house,bill_number,bill_year,source_url) VALUES (:bill_ref,:institution,:date_tabled,:source_document_ref,:extraction_status,:ocr_used,:is_simulated,:committee_name,:committee_url,:title,:bill_house,:bill_number,:bill_year,:source_url) RETURNING id"""), params)).scalar_one()
            count += 1
        if bill_id is None:
            bills = (await conn.execute(text("SELECT id,title FROM legislative_items WHERE bill_house=:house AND bill_year=:year"), {"house": row["bill_house"] or "na", "year": row["bill_year"] or (row["date_tabled"].year if row["date_tabled"] else date.today().year)})).all()
            report_title = canonical_title(row["title"])
            ranked = sorted(((ratio(report_title, canonical_title(b[1])) / 100, b[0], b[1]) for b in bills), reverse=True)[:3]
            for score, candidate_id, candidate_title in ranked:
                if score < 0.70:
                    continue
                await conn.execute(text("""INSERT INTO legislative_link_reviews (report_ref,candidate_bill_ref,match_method,confidence_score,explanation) VALUES (:report,:bill,'title-review',:score,:explanation) ON CONFLICT (report_ref,candidate_bill_ref) DO UPDATE SET confidence_score=EXCLUDED.confidence_score,explanation=EXCLUDED.explanation"""), {"report": report_id, "bill": candidate_id, "score": score, "explanation": f"Title-only candidate requires human confirmation. Report: {row['title']}; candidate: {candidate_title}."})
    return count


async def fetch_all() -> tuple[list[BillRow], list[NoticeRow], list[dict], int, int]:
    async with httpx.AsyncClient(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        tracker_page = await get(client, TRACKER_INDEX)
        tracker_url, tracker_date = choose_latest_tracker(tracker_page.text)
        tracker_text = extract_pdf((await get(client, tracker_url)).content)
        bills = parse_tracker(tracker_text, tracker_url, tracker_date)

        nav = await get(client, COMMITTEES_INDEX)
        notice_index = next((url for url in discover_notice_urls(nav.text) if url.rstrip("/").replace("/index.php", "") == MEMORANDA_INDEX), MEMORANDA_INDEX)
        notice_listing = await get(client, notice_index)
        def canonical_notice_url(url: str) -> str:
            parsed = urlparse(url)
            path = parsed.path.replace("/index.php/", "/")
            return f"https://www.parliament.go.ke{path}".rstrip("/")
        notice_urls = list(dict.fromkeys(canonical_notice_url(url) for url in discover_notice_urls(notice_listing.text) if canonical_notice_url(url) != MEMORANDA_INDEX.rstrip("/")))
        notices: list[NoticeRow] = []
        for url in notice_urls:
            page = await get(client, url)
            page_soup = BeautifulSoup(page.text, "lxml")
            attachment = next((urljoin(url, a["href"]) for a in page_soup.select("article a[href]") if PDF_RE.search(a["href"])), None)
            attachment_text = extract_pdf((await get(client, attachment)).content) if attachment else ""
            notices.extend(parse_notice_page(page.text, url, attachment_text))

        committees = discover_committees(nav.text)
        if len(committees) < MIN_COMMITTEES:
            raise RuntimeError(f"Only {len(committees)} committees discovered; refusing a partial report sync")
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
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            for statement in filter(None, (s.strip() for s in SCHEMA_SQL.split(";"))):
                await conn.execute(text(statement))
            new_bills = await upsert_bills(conn, bills, date.today())
            notice_count = await upsert_notices(conn, notices)
            new_reports = await upsert_reports(conn, reports)
            log.info("Synced %d bills (%d new), %d notice-bill rows, %d reports (%d new), %d/%d committees failed", len(bills), new_bills, notice_count, len(reports), new_reports, failed, committee_count)
    finally:
        await engine.dispose()
    return 1 if failed / committee_count > MAX_FAILED_FRACTION else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
