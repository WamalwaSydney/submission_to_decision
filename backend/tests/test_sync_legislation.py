from datetime import date

from app.scripts.sync_legislation import extract_committee_assignment, parse_tracker


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
        prefix = f"{number:3}. DLS/NA/BILLS/2/{number}/2024".ljust(30)
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
    assert all(by_number[n].committee_name is None for n in (3, 4, 5))
