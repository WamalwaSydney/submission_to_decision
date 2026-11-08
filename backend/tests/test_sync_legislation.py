import asyncio
from datetime import date
from uuid import uuid4

from app.scripts.sync_legislation import (
    BillRow,
    bill_documents,
    ensure_committee_id,
    extract_committee_assignment,
    merge_bill_stage_rows,
    normalize_tracker_reference,
    parse_bill_stage_tracker,
    parse_bill_tracker_columns,
    parse_tracker,
)


def test_committee_assignment_matches_official_directory_names_and_aliases():
    committees = [
        "Finance and National Planning",
        "Education",
        "Budget and Appropriations Committee",
    ]

    assert extract_committee_assignment(
        "The Legislative Proposal submitted to the Departmental Committee on Finance and National Planning for scrutiny",
        committees,
    ) == "Finance and National Planning"
    assert extract_committee_assignment(
        "Prepublication scrutiny by the Budget and Appropriation Committee",
        committees,
    ) == "Budget and Appropriations Committee"
    assert extract_committee_assignment("Published", committees) is None
    assert extract_committee_assignment(
        "Referred to the Committee on Education and the Departmental Committee on Finance and National Planning",
        committees,
    ) is None


def test_tracker_reads_assignment_only_from_status_column():
    committees = ["Finance and National Planning", "Education"]
    rows = []
    for number in range(1, 6):
        prefix = f"{number:3}. DLS/NA/BILLS/2/{number}/2024".ljust(28)
        title = f"The Sample Bill No. {number} of 2024".ljust(40)
        sponsor = "Hon. Sponsor".ljust(15)
        status = "Published" if number == 1 else (
            "Proposal submitted to the Committee on Education" if number == 2 else "Drafting stage"
        )
        rows.append(prefix + title + sponsor + status)

    bills = parse_tracker("\n".join(rows), "https://parliament.go.ke/tracker.pdf", date(2024, 4, 1), committees)
    by_number = {bill.number: bill for bill in bills}

    assert by_number[1].committee_name is None
    assert by_number[2].committee_name == "Education"
    assert by_number[2].title.startswith("The Sample Bill")
    assert all(by_number[n].committee_name is None for n in (3, 4, 5))


def test_rejoins_wrapped_parliament_file_reference():
    assert normalize_tracker_reference("DLS/NA/B ILLS/2/ 27/2023") == "DLS/NA/BILLS/2/27/2023"


def test_fixed_columns_preserve_bill_year_title_and_wrapped_file_reference():
    rows = []
    examples = [
        (65, 8, 2023, 27, "The Crops", "(Amendment)", "Bill, 2023"),
        (81, 8, 2024, 44, "The Breast", "feeding Mothers", "Bill, 2023"),
        (82, 9, 2024, 45, "The Sample", "(Amendment)", "Bill, 2023"),
        (83, 10, 2024, 46, "The Sample", "(Amendment)", "Bill, 2023"),
        (84, 11, 2024, 47, "The Sample", "(Amendment)", "Bill, 2023"),
    ]
    for serial, number, year, file_number, title_head, title_middle, title_end in examples:
        first = f"  {serial}.   DLS/NA/B ILLS/2/".ljust(30)
        first += title_head.ljust(18) + "Hon. Sponsor".ljust(30)
        first += f"NA Bill No. {number} of".ljust(17) + "Published"
        second = f"        {file_number}/2023".ljust(30)
        second += title_middle + " " * (78 - 30 - len(title_middle)) + str(year)
        third = " " * 28 + title_end
        rows.extend((first, second, third))

    bills = parse_tracker("\n".join(rows), "https://parliament.go.ke/tracker.pdf", date(2024, 4, 1))
    by_identifier = {bill.identifier: bill for bill in bills}

    assert by_identifier["NA/2023/Bill-008"].title == "The Crops (Amendment) Bill, 2023"
    assert by_identifier["NA/2023/Bill-008"].source_file_ref == "DLS/NA/BILLS/2/27/2023"
    assert by_identifier["NA/2024/Bill-008"].title == "The Breast feeding Mothers Bill, 2023"


def test_official_bill_tracker_stage_updates_match_by_house_number_and_year():
    source = "https://www.parliament.go.ke/bills-tracker-current.pdf"
    tracker_text = "\n".join([
        "1. The Public Participation Bill",
        "(National Assembly Bill No. 44 of 2025)",
        "The Senate Majority Leader",
        "Bill due for Second Reading on 22nd October 2026",
        "2. The Livestock Protection and Sustainability Bill",
        "(Senate Bills No. 32 of 2024)",
        "Sen. Example, MP",
        "Bill passed by the Senate with amendments and referred to the National Assembly for consideration.",
        "Bill at Committee of the Whole Stage",
    ])

    rows = parse_bill_stage_tracker(tracker_text, source, date(2026, 10, 16))
    by_id = {row.identifier: row for row in rows}

    assert by_id["NA/2025/Bill-044"].title == "The Public Participation Bill"
    assert by_id["NA/2025/Bill-044"].stage == "Awaiting Second Reading"
    assert by_id["SENATE/2024/Bill-032"].stage == "Committee of the Whole"
    assert by_id["SENATE/2024/Bill-032"].stage_as_at == date(2026, 10, 16)


def test_national_assembly_tracker_columns_provide_current_stage_and_clean_title():
    def line_with(pieces):
        line = [" "] * 185
        for position, value in pieces:
            line[position:position + len(value)] = value
        return "".join(line)

    header = line_with([
        (0, "S/No/ BILL"), (24, "SPONSOR"), (41, "NA/Sen."),
        (94, "1ST READ"), (109, "2ND READ"), (124, "3RD READ"),
        (139, "REMARKS"), (157, "ASSENT"),
    ])
    layout_rows = [
        line_with([(0, "  1.  The Assented Bill"), (94, "09/11/2022"), (157, "1/11/2024")]),
        line_with([(0, "  2.  The Stayed Bill"), (94, "12/04/2023"), (139, "Consideration of")]),
        line_with([(139, "the Bill stayed by")]),
        line_with([(139, "the Sponsor")]),
        line_with([(0, "  3.  The Committee Bill"), (109, "Committee Stage")]),
        line_with([(0, "  4.  The Reading Bill"), (124, "08/08/2025")]),
    ]
    raw = "\n".join([
        "1. The Assented Bill (NA Bill No. 34 of 2022)",
        "2. The Stayed Bill (NA Bill No. 35 of 2022)",
        "3. The Committee Bill (NA Bill No. 36 of 2022)",
        "4. The Reading Bill (NA Bill No. 37 of 2022)",
    ])
    layout = "\n".join([header, *layout_rows])

    columns = parse_bill_tracker_columns(layout)
    rows = parse_bill_stage_tracker(raw, "https://parliament.go.ke/na-bills.pdf", date(2026, 10, 15), layout)
    by_id = {row.identifier: row for row in rows}

    assert columns[1]["title"] == "The Assented Bill"
    assert by_id["NA/2022/Bill-034"].title == "The Assented Bill"
    assert by_id["NA/2022/Bill-034"].stage == "Assented"
    assert by_id["NA/2022/Bill-035"].stage == "Consideration Stayed"
    assert by_id["NA/2022/Bill-036"].stage == "Committee Stage"
    assert by_id["NA/2022/Bill-037"].stage == "Third Reading"


def test_bill_stage_merge_preserves_proposal_metadata_and_adds_official_source_document():
    proposal = BillRow(
        title="Existing proposal title",
        identifier="SENATE/2024/Bill-032",
        house="senate",
        number=32,
        year=2024,
        stage="Published",
        source_url="https://www.parliament.go.ke/proposals.pdf",
        source_file_ref="DLS/NA/BILLS/2/32/2024",
        committee_name="Agriculture, Livestock and Fisheries",
    )
    stage = BillRow(
        title="Tracker title",
        identifier="SENATE/2024/Bill-032",
        house="senate",
        number=32,
        year=2024,
        stage="Committee of the Whole",
        source_url="https://www.parliament.go.ke/bills-tracker.pdf",
        source_file_ref=None,
        stage_source_url="https://www.parliament.go.ke/bills-tracker.pdf",
        stage_as_at=date(2026, 10, 16),
    )
    tracker_only = BillRow(
        title="A tracker-only bill",
        identifier="SENATE/2026/Bill-099",
        house="senate",
        number=99,
        year=2026,
        stage="Second Reading",
        source_url="https://www.parliament.go.ke/bills-tracker.pdf",
        source_file_ref=None,
        stage_source_url="https://www.parliament.go.ke/bills-tracker.pdf",
        stage_as_at=date(2026, 10, 16),
    )

    merged = merge_bill_stage_rows([proposal], [stage, tracker_only])
    documents = bill_documents(merged[0])

    assert merged[0].title == "Existing proposal title"
    assert merged[0].committee_name == "Agriculture, Livestock and Fisheries"
    assert merged[0].stage == "Committee of the Whole"
    assert merged[0].stage_as_at == date(2026, 10, 16)
    assert len(merged) == 2
    added = next(row for row in merged if row.identifier == "SENATE/2026/Bill-099")
    assert added.title == "A tracker-only bill"
    assert added.stage == "Second Reading"
    assert len(documents) == 2
    assert any("Official Bills Tracker" in document["name"] for document in documents)


def test_bill_stage_merge_uses_only_unique_exact_title_and_year_fallback():
    proposal = BillRow(
        title="The Sample Bill, 2024",
        identifier="NA/2024/Proposal-example",
        house="na",
        number=None,
        year=2024,
        stage="Published",
        source_url="https://www.parliament.go.ke/proposals.pdf",
        source_file_ref=None,
    )
    official = BillRow(
        title="The Sample Bill 2024",
        identifier="NA/2024/Bill-009",
        house="na",
        number=9,
        year=2024,
        stage="Second Reading",
        source_url="https://www.parliament.go.ke/na-bills.pdf",
        source_file_ref=None,
        stage_source_url="https://www.parliament.go.ke/na-bills.pdf",
        stage_as_at=date(2026, 10, 15),
    )

    assert merge_bill_stage_rows([proposal], [official])[0].stage == "Second Reading"
    duplicate = BillRow(
        title="The Sample Bill 2024",
        identifier="NA/2024/Proposal-another",
        house="na",
        number=None,
        year=2024,
        stage="Published",
        source_url="https://www.parliament.go.ke/proposals.pdf",
        source_file_ref=None,
    )
    ambiguous = merge_bill_stage_rows([proposal, duplicate], [official])
    assert all(row.stage == "Published" for row in ambiguous)
    assert len(ambiguous) == 2


def test_latest_tracker_parses_explicit_committee_sponsor():
    def line_with(pieces):
        line = [" "] * 220
        for position, value in pieces:
            line[position:position + len(value)] = value
        return "".join(line)

    header = line_with([
        (0, "S/No/ BILL"), (24, "SPONSOR"), (110, "NA/Sen."),
        (140, "1ST READ"), (160, "2ND READ"), (180, "3RD READ"),
        (200, "REMARKS"), (220, "ASSENT"),
    ])
    row = line_with([
        (0, "  1. The Anti-Doping (Amendment) Bill, 2026"),
        (24, "Chairperson, Departmental Committee on Sports and Culture"),
        (140, "13/10/2026"),
    ])
    parsed = parse_bill_stage_tracker(
        "1. The Anti-Doping (Amendment) Bill, 2026 Chairperson, Departmental Committee on Sports and Culture NA Bill No. 66 of 2026",
        "https://parliament.go.ke/latest-bills-tracker.pdf",
        date(2026, 10, 15),
        "\n".join([header, row]),
        ["Sports and Culture", "Education"],
    )
    bill = next(item for item in parsed if item.identifier == "NA/2026/Bill-066")
    assert bill.title == "The Anti-Doping (Amendment) Bill, 2026"
    assert bill.committee_name == "Sports and Culture"


def test_committee_alias_merge_does_not_update_profile_foreign_key():
    canonical_id, duplicate_id = uuid4(), uuid4()

    class Result:
        def __init__(self, rows=()):
            self.rows = rows

        def fetchall(self):
            return self.rows

        def first(self):
            return self.rows[0] if self.rows else None

    class Connection:
        def __init__(self):
            self.statements = []

        async def execute(self, statement, params):
            sql = str(statement)
            self.statements.append(sql)
            if sql.startswith("SELECT id,name FROM committees"):
                return Result([
                    (canonical_id, "Budget and Appropriations Committee"),
                    (duplicate_id, "Budget and Appropriation Committee"),
                ])
            return Result()

    conn = Connection()
    selected_id = asyncio.run(ensure_committee_id(conn, "Budget and Appropriations Committee"))

    assert selected_id == canonical_id
    assert any("UPDATE users SET committee_id" in sql for sql in conn.statements)
    assert any("UPDATE legislative_items SET committee_id" in sql for sql in conn.statements)
    assert not any("representative_profiles" in sql for sql in conn.statements)


# ---- Formats from the live Bills Tracker (as at 23 October 2026) ----

def _layout_line(pieces, width=185):
    line = [" "] * width
    for position, value in pieces:
        line[position:position + len(value)] = value
    return "".join(line)


LIVE_HEADER = _layout_line([
    (0, "S/No/ BILL"), (25, "SPONSOR"), (41, "NA/Sen."), (56, "DATED"), (67, "MATURITY"),
    (84, "GAZETTE"), (95, "1ST READ"), (110, "2ND READ"), (125, "3RD READ"), (139, "REMARKS"), (157, "ASSENT"),
])


def test_tracker_references_with_abbreviated_house_names_are_parsed():
    raw = "\n".join([
        "136. The Breastfeeding Mothers Bill, 2024 Hon. Sabina Chege, MP NA. Bill No. 8 of 2024 16/02/2024 29/02/2024 34 02/05/2024 30/07/2025; 06/08/2025; 13/08/2025. Committee Stage: 14/10/2026 14/10/2026 Passed",
        "22. The County Governments Additional Allocations (No.2) Bill, 2022 Chairperson, Standing Committee on Finance and Budget Sen. Bill No. 4 of 2022 26/10/2022 08/11/2022 190 29/11/2022 29/11/2022 01/12/2022 12/12/2022",
    ])
    layout = "\n".join([
        LIVE_HEADER,
        _layout_line([(0, "  22.  The County"), (56, "26/10/2022"), (67, "08/11/2022"), (95, "29/11/2022"), (110, "29/11/2022;"), (125, "01/12/2022"), (157, "12/12/2022")]),
        _layout_line([(110, "Committee"), ]),
        _layout_line([(110, "Stage: 30/11/2022")]),
        _layout_line([(0, " 136.  The Breastfeeding"), (56, "16/02/2024"), (67, "29/02/2024"), (95, "02/05/2024"), (110, "30/07/2025;"), (125, "14/10/2026"), (139, "Passed")]),
        _layout_line([(110, "06/08/2025;")]),
        _layout_line([(110, "13/08/2025.")]),
        _layout_line([(110, "Committee")]),
        _layout_line([(110, "Stage:")]),
        _layout_line([(110, "14/10/2026")]),
    ])
    rows = {row.identifier: row for row in parse_bill_stage_tracker(raw, "https://parliament.go.ke/bt.pdf", date(2026, 10, 23), layout)}

    breastfeeding = rows["NA/2024/Bill-008"]
    assert breastfeeding.title == "The Breastfeeding Mothers Bill, 2024"
    assert breastfeeding.stage == "Passed by National Assembly"
    assert [event["stage"] for event in breastfeeding.history] == [
        "Published", "First Reading", "Second Reading", "Committee of the Whole House", "Third Reading",
    ]
    assert breastfeeding.history[0]["date"] == "2024-02-16"
    assert breastfeeding.history[2]["note"].endswith("2025-07-30, 2025-08-06, 2025-08-13).")

    senate_bill = rows["SENATE/2022/Bill-004"]
    assert senate_bill.house == "senate"
    assert senate_bill.stage == "Assented"
    assert senate_bill.history[-1] == {"date": "2022-12-12", "stage": "Assented", "note": "Assented to by the President."}


def test_official_title_replaces_proposal_working_title_on_exact_match():
    proposal = BillRow(title="The Breast feeding Mothers Bill, 2023", identifier="NA/2024/Bill-008", house="na", number=8, year=2024,
                       stage="Published", source_url="https://parliament.go.ke/lp.pdf", source_file_ref="DLS/NA/BILLS/2/44/2023")
    official = BillRow(title="The Breastfeeding Mothers Bill, 2024", identifier="NA/2024/Bill-008", house="na", number=8, year=2024,
                       stage="Passed by National Assembly", source_url="https://parliament.go.ke/bt.pdf", source_file_ref=None,
                       stage_source_url="https://parliament.go.ke/bt.pdf", stage_as_at=date(2026, 10, 23),
                       history=({"date": "2024-02-16", "stage": "Published", "note": "Published in the Kenya Gazette."},))
    merged = merge_bill_stage_rows([proposal], [official])[0]
    assert merged.title == "The Breastfeeding Mothers Bill, 2024"
    assert merged.stage == "Passed by National Assembly"
    assert merged.source_file_ref == "DLS/NA/BILLS/2/44/2023"
    assert merged.history == official.history


def test_proposal_only_bill_lists_its_tracker_once_and_keeps_bill_pdfs():
    from app.scripts.sync_legislation import merge_tracker_documents
    row = BillRow(title="The Sample Bill, 2024", identifier="NA/2024/Bill-090", house="na", number=90, year=2024,
                  stage="Published", source_url="https://parliament.go.ke/lp.pdf", source_file_ref=None)
    assert bill_documents(row) == [{"name": "Legislative Proposals Tracker", "url": "https://parliament.go.ke/lp.pdf"}]
    existing = [
        {"name": "Legislative Proposals Tracker", "url": "https://parliament.go.ke/old-lp.pdf"},
        {"name": "Legislative Proposals Tracker", "url": "https://parliament.go.ke/old-lp.pdf"},
        {"name": "Official bill document (Parliament PDF)", "url": "https://parliament.go.ke/bill.pdf"},
    ]
    assert merge_tracker_documents(existing, row) == [
        {"name": "Legislative Proposals Tracker", "url": "https://parliament.go.ke/lp.pdf"},
        {"name": "Official bill document (Parliament PDF)", "url": "https://parliament.go.ke/bill.pdf"},
    ]


# ---- Calls for memoranda (wording from live parliament.go.ke notice pages) ----

def _notice_html(heading: str, body: str, submitted: str = "Submitted by clerk on 8 August 2025") -> str:
    return f"<html><head><title>{heading} | The Kenyan Parliament Website</title></head><body><article><h1>{heading}</h1><p>{submitted}</p><p>{body}</p></article></body></html>"


def test_notice_deadline_wordings():
    from app.scripts.sync_legislation import notice_deadline
    assert notice_deadline("All submissions must be received by 5:00 pm on Thursday, 28th August 2025.") == date(2025, 8, 28)
    assert notice_deadline("to be received on or before Friday, 26 th September, 2025 at 5.00 p.m.") == date(2025, 9, 26)
    assert notice_deadline("not later than 31st August 2026") == date(2026, 8, 31)
    assert notice_deadline("Submissions are welcome.") is None


def test_senate_notice_with_plural_reference():
    from app.scripts.sync_legislation import parse_notice_page
    html = _notice_html(
        "INVITATION FOR SUBMISSION OF MEMORANDA AND PUBLIC HEARINGS :- THE CONSTITUTION OF KENYA ( AMENDMENT) BILL, 2025 ( SENATE BILLS NO. 13 of 2025)",
        "Memoranda may be emailed, to be received on or before Friday, 26 th September, 2025 at 5.00 p.m.",
        "Submitted by clerk on 2 September 2025",
    )
    rows = parse_notice_page(html, "https://www.parliament.go.ke/invitation-x")
    assert len(rows) == 1
    row = rows[0]
    assert (row.bill_house, row.bill_number, row.bill_year) == ("senate", 13, 2025)
    assert row.deadline == date(2025, 9, 26) and row.notice_date == date(2025, 9, 2)
    assert "CONSTITUTION OF KENYA" in row.bill_title.upper()


def test_prose_notice_keeps_only_the_bill_name():
    from app.scripts.sync_legislation import parse_notice_page
    html = _notice_html(
        "INVITATION FOR SUBMISSION OF MEMORANDA",
        "The Senate Standing Committee on Health invites the public to submit memoranda on the Assisted Reproductive Technology Bill "
        "(National Assembly Bills No. 61 of 2022). All submissions must be received by 5:00 pm on Friday, 23rd January 2026.",
        "Submitted by clerk on 20 December 2025",
    )
    rows = parse_notice_page(html, "https://www.parliament.go.ke/invitation-y")
    assert [(r.bill_title, r.bill_number, r.bill_year) for r in rows] == [("Assisted Reproductive Technology Bill", 61, 2022)]


def test_notice_without_a_bill_is_skipped():
    from app.scripts.sync_legislation import parse_notice_page
    html = _notice_html("NOTIFICATION OF APPROVAL HEARINGS", "Nominees will appear on or before 10th March 2026.", "Submitted by clerk on 1 March 2026")
    assert parse_notice_page(html, "https://www.parliament.go.ke/approval-hearing") == []


def test_notice_discovery_ignores_stale_listing_and_other_sites():
    from app.scripts.sync_legislation import notice_page_links
    html = """
      <a href="/submission-memoranda">Submission of Memoranda</a>
      <a href="https://www.parliament.go.ke/submission-memoranda-0">Submission of Memoranda</a>
      <a href="/index.php/invitation-submit-memoranda-judges-retirement-benefits-bill">Judges</a>
      <a href="https://example.com/invitation-submit-memoranda">elsewhere</a>
      <a href="/sites/default/files/2026-06/memoranda.pdf">PDF</a>
      <a href="/search/node?keys=memoranda">search</a>"""
    assert notice_page_links(html, "https://www.parliament.go.ke/search/node?keys=memoranda") == [
        "https://www.parliament.go.ke/invitation-submit-memoranda-judges-retirement-benefits-bill",
    ]


def test_notice_posted_after_its_deadline_opens_on_an_earlier_date():
    from app.scripts.sync_legislation import parse_notice_page
    html = _notice_html(
        "INVITATION FOR SUBMISSION OF MEMORANDA :- THE CONSTITUTION OF KENYA ( AMENDMENT) BILL, 2025 ( SENATE BILLS NO. 13 of 2025)",
        "Published on 22nd July 2025. Memoranda to be received on or before Friday, 26 th September, 2025 at 5.00 p.m.",
        "Submitted by clerk on 2 October 2025",
    )
    row = parse_notice_page(html, "https://www.parliament.go.ke/invitation-z")[0]
    assert row.notice_date == date(2025, 7, 22) and row.deadline == date(2025, 9, 26)
