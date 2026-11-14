"""Sync county assembly bills into Participation Trace.

Run from ``backend/``::

    python -m app.scripts.sync_county_bills

It also runs at the end of ``app.scripts.sync_legislation``.

Sources, per county:

* the assembly's own bills page, for each bill's title and official PDF;
* the assembly's own Acts page (Nairobi), with each Act's PDF and date of assent;
* Kenya Law's list of the county's Acts in force, to mark bills that became law
  and to add Acts whose bills the assembly no longer lists;
* the assembly's papers-laid page (Nairobi), for committee reports on bills. Each
  report is linked to its county bill by the assembly bill number or the bill's
  exact name, and is then read and analysed like a Parliament report
  (fill_gaps, analyse_reports).

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
from rapidfuzz.fuzz import ratio
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
    acts_url: str | None = None     # the assembly's own list of Acts
    reports_url: str | None = None  # the assembly's list of papers laid (committee reports)


COUNTIES = (
    County("ncca", "NCCA", "Nairobi City County Assembly", "https://nairobiassembly.go.ke/bills/", "nairobiassembly.go.ke", "ke-047",
           acts_url="https://nairobiassembly.go.ke/acts/", reports_url="https://nairobiassembly.go.ke/papers-laid/"),
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
    act_source: str = "Kenya Law"
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


MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                        "september", "october", "november", "december"], 1)}
# Laws passed every year under the same name: an Act only ever matches the bill of its own year.
RECURRING_LAW_RE = re.compile(r"appropriation|finance|supplementary|allocation|estimates|revenue", re.I)
# A bill can take a few years to become law ("... Bill, 2023" assented as "... Act, 2026").
MAX_YEARS_TO_ASSENT = 3


def parse_day(value: str) -> date | None:
    """'8th April, 2026' -> date(2026, 4, 8)."""
    match = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})", value or "")
    if not match or match.group(2).lower() not in MONTHS:
        return None
    try:
        return date(int(match.group(3)), MONTHS[match.group(2).lower()], int(match.group(1)))
    except ValueError:
        return None


def _table_rows(html: str, page_url: str, county: County, path: str):
    """(title, url, date) for each table row whose title links to a document under `path` on the assembly's site."""
    for row in BeautifulSoup(html, "lxml").select("tr"):
        anchor = next((a for a in row.select("a[href]") if clean(a.get_text(" ", strip=True))), None)
        url = _trusted(anchor["href"], page_url, county.domain) if anchor else None
        if not url or path not in url:
            continue
        cells = [clean(td.get_text(" ", strip=True)) for td in row.select("td")]
        day = next((d for d in map(parse_day, cells) if d), None)
        yield clean(anchor.get_text(" ", strip=True).replace("", " ")), url, day


def parse_assembly_acts(html: str, page_url: str, county: County) -> list[tuple[str, str, date | None]]:
    """Acts on the assembly's own Acts page, with the PDF and the date of assent."""
    acts = [(title, url, day) for title, url, day in _table_rows(html, page_url, county, "/uploads/act")
            if re.search(r"\bacts?\b", title, re.I)]
    return list({url: (title, url, day) for title, url, day in acts}.values())


def merge_acts(bills: list[CountyBill], acts: list[tuple[str, str, date | None]], source: str = "Kenya Law") -> list[CountyBill]:
    """Mark bills that became law; add Acts whose bills are no longer listed.

    An Act matches the bill with the same name and year, or else the one bill with the same
    name from up to MAX_YEARS_TO_ASSENT years earlier that has no Act yet (never for laws passed every year).
    """
    by_key = {title_key(bill.title): bill for bill in bills}
    merged = list(bills)
    later = []
    for act in acts:
        if title_key(act[0]) in by_key:
            _attach_act(by_key[title_key(act[0])], act, source)
        else:
            later.append(act)
    for act in later:
        words, year = title_key(act[0])
        bill = by_key.get((words, year))
        if bill is None and year and not RECURRING_LAW_RE.search(act[0]):
            earlier = [b for (w, y), b in by_key.items() if w == words and y and 0 < year - y <= MAX_YEARS_TO_ASSENT and not b.act_url]
            bill = earlier[0] if len(earlier) == 1 else None
        if bill is None:
            bill = CountyBill(title=act[0], year=year, number=None)
            by_key[(words, year)] = bill
            merged.append(bill)
        _attach_act(bill, act, source)
    return merged


def _attach_act(bill: CountyBill, act: tuple[str, str, date | None], source: str) -> None:
    act_title, act_url, act_date = act
    bill.act_url, bill.act_title, bill.act_source = act_url, act_title, source
    bill.act_date = act_date or bill.act_date


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
        documents.append({"name": f"{bill.act_title} ({bill.act_source})", "url": bill.act_url})
    return documents


def history_for(county: County, bill: CountyBill) -> list[dict]:
    events = []
    if bill.document_url:
        events.append({"date": f"{bill.year}" if bill.year else "Undated", "stage": LISTED_STAGE,
                       "note": f"Published on the {county.institution} website. The assembly does not publish the bill's later stages online."})
    if bill.act_url:
        events.append({"date": bill.act_date.isoformat() if bill.act_date else "Undated", "stage": ASSENTED_STAGE,
                       "note": f"Assented to by the Governor and in force as a county Act, as listed by {'the ' if bill.act_source != 'Kenya Law' else ''}{bill.act_source}."})
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
    own: list = []
    if county.acts_url:
        try:
            page = await client.get(county.acts_url)
            page.raise_for_status()
            own = parse_assembly_acts(page.text, str(page.url), county)
        except httpx.HTTPError as exc:
            log.warning("Acts page unavailable for %s: %s", county.institution, exc)
        # Second, so the assembly's own copy of an Act (a PDF anyone can read) is the one linked.
        merged = merge_acts(merged, own, source=county.institution)
    log.info("%s: %d bills listed, %d Acts on Kenya Law, %d on the assembly's Acts page, %d records",
             county.institution, len(bills), len(acts), len(own), len(merged))
    return merged


# --------------------------------------------------------------------------
# Committee reports on county bills
# --------------------------------------------------------------------------
REPORT_SKIP_RE = re.compile(r"pending\s+bills|regulations", re.I)
COMMITTEE_RE = re.compile(r"\b((?:sectoral|select|joint|ad[\s-]*hoc)\s+committees?\s+on\s+.+?)\s+(?:on|in)\s+(?:the\s+)?(?:consideration|report|vetting)\b", re.I)
REPORT_BILL_NUMBER_RE = re.compile(r"\b(?:county\s+)?assembly\s+bill\s+no\.?\s*(\d+)\s+of\s+(20\d{2})\b", re.I)
COUNTY_NAME_WORDS = {"nairobi", "city", "county", "trans", "nzoia", "transnzoia"}


def parse_assembly_reports(html: str, page_url: str, county: County) -> list[dict]:
    """Committee reports on bills from the assembly's papers-laid page, as committee_reports rows."""
    rows = {}
    for title, url, day in _table_rows(html, page_url, county, "/uploads/paperlaid/"):
        if not re.search(r"\bbills?\b", title, re.I) or REPORT_SKIP_RE.search(title):
            continue
        number = REPORT_BILL_NUMBER_RE.search(title)
        committee = COMMITTEE_RE.search(title)
        rows[url] = {
            "institution": county.institution, "date_tabled": day, "title": title[:1000],
            "committee_name": committee.group(1).title()[:255] if committee else None,
            "committee_url": page_url, "bill_house": county.key,
            "bill_number": int(number.group(1)) if number else None,
            "bill_year": int(number.group(2)) if number else None, "source_url": url,
        }
    return list(rows.values())


def _county_words(words: list[str]) -> list[str]:
    return [w for w in words if w not in COUNTY_NAME_WORDS]


async def resolve_county_report_bill(conn, county: County, row: dict):
    """The county bill a report is on: by assembly bill number and year, else by the bill's exact name and year."""
    from app.scripts.sync_legislation import _bill_name_words, _compact, name_matches, report_bill_reference
    if row.get("bill_number") and row.get("bill_year"):
        found = (await conn.execute(text(
            "SELECT id FROM legislative_items WHERE bill_house=:house AND bill_number=:number AND bill_year=:year AND is_simulated=false"),
            {"house": county.key, "number": row["bill_number"], "year": row["bill_year"]})).all()
        if len(found) == 1:
            return found[0].id
    words, year = report_bill_reference(row.get("title") or "")
    words = _county_words(words)
    year = year or row.get("bill_year")
    if not words or not year:
        return None
    bills = (await conn.execute(text(
        "SELECT id, title FROM legislative_items WHERE bill_house=:house AND bill_year=:year AND is_simulated=false"),
        {"house": county.key, "year": year})).all()
    best, best_len = [], 0
    for bill in bills:
        bill_words = _county_words(_bill_name_words(bill.title))
        if name_matches(words, bill_words):
            size = len(_compact(bill_words))
            if size > best_len:
                best, best_len = [bill], size
            elif size == best_len:
                best.append(bill)
    return best[0].id if len(best) == 1 else None


async def upsert_county_reports(conn, county: County, rows: list[dict]) -> tuple[int, int]:
    """Store reports (new ones wait to be read) and link each to its bill. Returns (new, linked)."""
    new = linked = 0
    for row in rows:
        bill_id = await resolve_county_report_bill(conn, county, row)
        linked += bill_id is not None
        params = {**row, "bill_ref": bill_id, "date_tabled": row["date_tabled"] or date.today()}
        existing = (await conn.execute(text("SELECT id FROM committee_reports WHERE source_url=:source_url"), {"source_url": row["source_url"]})).first()
        if existing:
            # Never drop a link a person or an earlier sync made.
            await conn.execute(text("""UPDATE committee_reports SET bill_ref=COALESCE(bill_ref, :bill_ref), title=:title,
                committee_name=COALESCE(:committee_name, committee_name), date_tabled=:date_tabled, bill_number=:bill_number, bill_year=:bill_year
                WHERE id=:id"""), {**params, "id": existing[0]})
            continue
        await conn.execute(text("""INSERT INTO committee_reports (id, bill_ref, institution, date_tabled, source_document_ref, extraction_status,
                ocr_used, is_simulated, committee_name, committee_url, title, bill_house, bill_number, bill_year, source_url)
            VALUES (:id, :bill_ref, :institution, :date_tabled, :source_url, 'pending', false, false, :committee_name, :committee_url,
                :title, :bill_house, :bill_number, :bill_year, :source_url)"""), {**params, "id": uuid.uuid4()})
        new += 1
    return new, linked


async def fetch_county_reports(client: httpx.AsyncClient, county: County) -> list[dict]:
    if not county.reports_url:
        return []
    page = await client.get(county.reports_url)
    page.raise_for_status()
    return parse_assembly_reports(page.text, str(page.url), county)


ACT_ALIAS_MIN_SCORE = 80


async def _same_act_stored(conn, county: County, bill: CountyBill) -> str | None:
    """An Act already stored under another spelling of its name ("Culture Heritage" / "Cultural Heritage"):
    the one Act of the same county and year whose name is this close."""
    if not (bill.act_url and not bill.document_url and bill.year):
        return None
    rows = (await conn.execute(text(
        "SELECT identifier, title FROM legislative_items WHERE bill_house=:house AND bill_year=:year AND stage=:stage AND identifier LIKE :acts"),
        {"house": county.key, "year": bill.year, "stage": ASSENTED_STAGE, "acts": f"{county.prefix}/%/Act-%"})).all()
    words = title_key(bill.title)[0]
    close = [row.identifier for row in rows if ratio(words, title_key(row.title)[0]) >= ACT_ALIAS_MIN_SCORE]
    return close[0] if len(close) == 1 else None


async def upsert_county_bills(conn, county: County, bills: list[CountyBill]) -> tuple[int, int]:
    new = updated = 0
    today = date.today()
    for bill in bills:
        identifier = identifier_for(county, bill)
        existing = (await conn.execute(text("SELECT id, stage, documents FROM legislative_items WHERE identifier=:identifier"), {"identifier": identifier})).first()
        alias = None if existing else await _same_act_stored(conn, county, bill)
        if alias:
            # Keep the stored name; add the assembly's copy of the Act.
            row = (await conn.execute(text("SELECT documents FROM legislative_items WHERE identifier=:identifier"), {"identifier": alias})).first()
            documents = row[0] if isinstance(row[0], list) else json.loads(row[0] or "[]")
            ours = [d for d in documents_for(county, bill) if d["url"] not in {x.get("url") for x in documents if isinstance(x, dict)}]
            if ours:
                await conn.execute(text("UPDATE legislative_items SET documents=CAST(:documents AS jsonb), source_updated_at=:updated WHERE identifier=:identifier"),
                                   {"documents": json.dumps(documents + ours), "updated": today, "identifier": alias})
            updated += 1
            continue
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
                continue
            try:  # reports after bills, so each can find its bill; a failure here keeps the bills
                reports = await fetch_county_reports(client, county)
                async with conn.begin_nested():
                    new, linked = await upsert_county_reports(conn, county, reports)
                if reports:
                    log.info("%s: %d committee reports on bills, %d new, %d linked to their bill", county.institution, len(reports), new, linked)
            except Exception as exc:
                log.error("County reports failed for %s: %s", county.institution, exc)
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
