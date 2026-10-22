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
    assert len(merged) == 1
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
