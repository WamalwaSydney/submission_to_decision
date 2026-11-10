"""Sync county assembly bills into Participation Trace.

Run from ``backend/``::

    python -m app.scripts.sync_county_bills

It also runs at the end of ``app.scripts.sync_legislation``.

Sources, per county:

* the assembly's own bills page, for each bill's title and official PDF;
* Kenya Law's list of the county's Acts in force, to mark bills that became law
  and to add Acts whose bills the assembly no longer lists.

Neither assembly publishes a bill's current stage online, so a listed bill is
recorded as "Published by the assembly" until it appears on Kenya Law as an
Act, or until the assembly's Clerk's Office records the stage. The sync never
overwrites a stage set by someone else, except to mark a bill as law.

Only document links on the assembly's own domain are accepted: the Trans Nzoia
site has carried injected spam links, so other links are ignored.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

log = logging.getLogger("sync_county_bills")

HEADERS = {"User-Agent": "UraiaLegislationSync/1.0 (civic-tech research; non-commercial)"}
LISTED_STAGE = "Published by the assembly"
ASSENTED_STAGE = "Assented"
KENYA_LAW = "https://kenyalaw.org"


@dataclass(frozen=True)
class County:
    key: str          # stored in bill_house
    prefix: str       # identifier prefix
    institution: str
    bills_url: str
    domain: str       # only links on this host are trusted
    kenya_law_code: str


COUNTIES = (
    County("ncca", "NCCA", "Nairobi City County Assembly", "https://nairobiassembly.go.ke/bills/", "nairobiassembly.go.ke", "ke-047"),
    County("tnca", "TNCA", "Trans Nzoia County Assembly", "https://transnzoiaassembly.go.ke/index.php/ongoing-passed-bills", "transnzoiaassembly.go.ke", "ke-026"),
)


@dataclass
class CountyBill:
    title: str
    year: int | None
    number: int | None
    document_url: str | None = None
    act_url: str | None = None
    act_title: str | None = None
    act_date: date | None = None
    history: list = field(default_factory=list)


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace(" ", " ")).strip(" .;,:-_")


BILL_NUMBER_RE = re.compile(r"\(\s*(?:county\s+)?assembly\s+bill\s+no\.?\s*(\d+)\s+of\s+(20\d{2})\s*\)?", re.I)
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")


def title_key(title: str) -> tuple[str, int | None]:
    """A Bill and the Act it became share this key: same words, same year."""
    value = BILL_NUMBER_RE.sub(" ", title.lower())
    years = YEAR_RE.findall(value)
    value = re.sub(r"\b(the|bill|act|of|no|county|city)\b", " ", YEAR_RE.sub(" ", value))
    return re.sub(r"[^a-z0-9]+", " ", value).strip(), int(years[-1]) if years else None


def _trusted(href: str, page_url: str, domain: str) -> str | None:
    url = urljoin(page_url, href).split("#")[0]
    host = (urlparse(url).hostname or "").lower()
    if urlparse(url).scheme not in {"http", "https"} or not (host == domain or host.endswith("." + domain)):
        return None
    return url


def parse_nairobi_bills(html: str, page_url: str, county: County) -> list[CountyBill]:
    bills: dict[str, CountyBill] = {}
    for anchor in BeautifulSoup(html, "lxml").select("a[href]"):
        url = _trusted(anchor["href"], page_url, county.domain)
        if not url or "/uploads/bill/" not in url:
            continue
        raw = clean(anchor.get_text(" ", strip=True))
        if not re.search(r"\bbill\b", raw, re.I):
            continue
        number_match = BILL_NUMBER_RE.search(raw)
        title = clean(BILL_NUMBER_RE.sub("", raw))
        if not re.search(r"\b(19|20)\d{2}\b", title):
            folder_year = re.search(r"/uploads/bill/(20\d{2})/", url)
            title = f"{title}, {folder_year.group(1)}" if folder_year else title
        _, year = title_key(title)
        bills.setdefault(title.lower(), CountyBill(
            title=title, year=year,
            number=int(number_match.group(1)) if number_match else None, document_url=url,
        ))
    return list(bills.values())


def parse_trans_nzoia_bills(html: str, page_url: str, county: County) -> list[CountyBill]:
    bills: dict[str, CountyBill] = {}
    for anchor in BeautifulSoup(html, "lxml").select("a[href]"):
        url = _trusted(anchor["href"], page_url, county.domain)
        label = clean(anchor.get_text(" ", strip=True))
        if not url or "download=" not in url or not label.lower().endswith(".pdf"):
            continue
        name = clean(re.sub(r"\.pdf$", "", label, flags=re.I).replace("_", " "))
        if not re.search(r"\bbill\b", name, re.I):
            continue  # e.g. a legislative supplement, which is not a bill
        title = name if name.lower().startswith("the ") else f"The {name}"
        title = re.sub(r"\btransnzoia\b", "Trans Nzoia", title, flags=re.I)
        # Title case, but keep short joining words lower case.
        title = " ".join(w if w.lower() in {"of", "and", "the", "for"} and i else w.capitalize() for i, w in enumerate(title.split()))
        title = re.sub(r"\bBill (\d{4})$", r"Bill, \1", title)
        if not re.search(r"trans\s*nzoia", title, re.I):
            # "The County Roads Bill" becomes "The Trans Nzoia County Roads Bill", not "... County County ..."
            title = re.sub(r"^The (?:County )?", "The Trans Nzoia County ", title, count=1)
        _, year = title_key(title)
        bills.setdefault(title.lower(), CountyBill(title=title, year=year, number=None, document_url=url))
    return list(bills.values())


def parse_kenya_law_acts(html: str, county: County) -> list[tuple[str, str, date | None]]:
    acts = []
    for anchor in BeautifulSoup(html, "lxml").select(f'a[href^="/akn/{county.kenya_law_code}/act/"]'):
        title = clean(anchor.get_text(" ", strip=True))
        if not title:
            continue
        when = re.search(r"@(\d{4}-\d{2}-\d{2})", anchor["href"])
        acts.append((title, urljoin(KENYA_LAW, anchor["href"]), date.fromisoformat(when.group(1)) if when else None))
    return list(dict.fromkeys(acts))


def merge_acts(bills: list[CountyBill], acts: list[tuple[str, str, date | None]]) -> list[CountyBill]:
    """Mark bills that became law; add Acts whose bills are no longer listed."""
    by_key = {title_key(bill.title): bill for bill in bills}
    merged = list(bills)
    for act_title, act_url, act_date in acts:
        key = title_key(act_title)
        bill = by_key.get(key)
        if bill is None:
            bill = CountyBill(title=act_title, year=key[1], number=None)
            by_key[key] = bill
            merged.append(bill)
        bill.act_url, bill.act_title, bill.act_date = act_url, act_title, act_date
    return merged


def identifier_for(county: County, bill: CountyBill) -> str:
    if bill.number and bill.year:
        return f"{county.prefix}/{bill.year}/Bill-{bill.number:03d}"
    digest = hashlib.sha1(title_key(bill.title)[0].encode()).hexdigest()[:10]
    return f"{county.prefix}/{bill.year or 'undated'}/{'Act' if bill.act_url and not bill.document_url else 'Bill'}-{digest}"


def documents_for(county: County, bill: CountyBill) -> list[dict]:
    documents = []
    if bill.document_url:
        documents.append({"name": f"Official bill document ({county.institution})", "url": bill.document_url})
    if bill.act_url:
        documents.append({"name": f"{bill.act_title} (Kenya Law)", "url": bill.act_url})
    return documents


def history_for(county: County, bill: CountyBill) -> list[dict]:
    events = []
    if bill.document_url:
        events.append({"date": f"{bill.year}" if bill.year else "Undated", "stage": LISTED_STAGE,
                       "note": f"Published on the {county.institution} website. The assembly does not publish the bill's later stages online."})
    if bill.act_url:
        events.append({"date": bill.act_date.isoformat() if bill.act_date else "Undated", "stage": ASSENTED_STAGE,
                       "note": "Assented to by the Governor and in force as a county Act, as listed on Kenya Law."})
    return events


async def fetch_county(client: httpx.AsyncClient, county: County) -> list[CountyBill]:
    page = await client.get(county.bills_url)
    page.raise_for_status()
    parser = parse_nairobi_bills if county.key == "ncca" else parse_trans_nzoia_bills
    bills = parser(page.text, str(page.url), county)
    try:
        law = await client.get(f"{KENYA_LAW}/legislation/{county.kenya_law_code}/")
        law.raise_for_status()
        acts = parse_kenya_law_acts(law.text, county)
    except httpx.HTTPError as exc:
        log.warning("Kenya Law unavailable for %s: %s", county.institution, exc)
        acts = []
    merged = merge_acts(bills, acts)
    log.info("%s: %d bills listed, %d Acts on Kenya Law, %d records", county.institution, len(bills), len(acts), len(merged))
    return merged


async def upsert_county_bills(conn, county: County, bills: list[CountyBill]) -> tuple[int, int]:
    new = updated = 0
    today = date.today()
    for bill in bills:
        identifier = identifier_for(county, bill)
        existing = (await conn.execute(text("SELECT id, stage, documents FROM legislative_items WHERE identifier=:identifier"), {"identifier": identifier})).first()
        stage = ASSENTED_STAGE if bill.act_url else LISTED_STAGE
        ours = documents_for(county, bill)
        params = {
            "title": bill.title[:500], "identifier": identifier, "institution": county.institution,
            "house": county.key, "number": bill.number, "year": bill.year,
            "source_url": bill.document_url or bill.act_url, "updated": today,
            "history": json.dumps(history_for(county, bill)),
        }
        if existing is None:
            await conn.execute(text("""INSERT INTO legislative_items (id, title, identifier, institution, stage, documents, status_history, is_simulated, bill_house, bill_number, bill_year, source_url, source_updated_at, source_status)
                VALUES (:id, :title, :identifier, :institution, :stage, CAST(:documents AS jsonb), CAST(:history AS json), false, :house, :number, :year, :source_url, :updated, 'county-sync')"""),
                {**params, "id": uuid.uuid4(), "stage": stage, "documents": json.dumps(ours)})
            new += 1
            continue
        documents = existing[2] if isinstance(existing[2], list) else json.loads(existing[2] or "[]")
        known = {d.get("url") for d in documents if isinstance(d, dict)}
        documents = documents + [d for d in ours if d["url"] not in known]
        # Keep a stage the Clerk's Office recorded; only becoming law overrides it.
        keep_stage = existing[1] if existing[1] and existing[1] != LISTED_STAGE else stage
        await conn.execute(text("""UPDATE legislative_items SET title=:title, institution=:institution, stage=:stage, documents=CAST(:documents AS jsonb),
                bill_house=:house, bill_number=:number, bill_year=:year, source_url=:source_url, source_updated_at=:updated,
                status_history=CASE WHEN :stage_is_default THEN CAST(:history AS json) ELSE status_history END, is_simulated=false
                WHERE identifier=:identifier"""),
            {**params, "stage": ASSENTED_STAGE if bill.act_url else keep_stage, "documents": json.dumps(documents),
             "stage_is_default": keep_stage in {LISTED_STAGE, ASSENTED_STAGE}})
        updated += 1
    return new, updated


async def sync_counties(conn) -> dict:
    """Fetch and store every configured county. One failing county does not stop the others."""
    from app.committee_assignment import ensure_county_committees
    results = {}
    log.info("County committees created: %d", await ensure_county_committees(conn))
    async with httpx.AsyncClient(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        for county in COUNTIES:
            try:
                bills = await fetch_county(client, county)
                async with conn.begin_nested():
                    results[county.institution] = await upsert_county_bills(conn, county, bills)
            except Exception as exc:  # network, parsing or database: report and carry on
                log.error("County sync failed for %s: %s", county.institution, exc)
                results[county.institution] = None
    return results


async def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        log.error("DATABASE_URL is not set")
        return 1
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            results = await sync_counties(conn)
            from app.committee_assignment import assign_committees
            await assign_committees(conn)
    finally:
        await engine.dispose()
    for institution, result in results.items():
        log.info("%s: %s", institution, "failed" if result is None else f"{result[0]} new, {result[1]} updated")
    return 0 if all(result is not None for result in results.values()) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
