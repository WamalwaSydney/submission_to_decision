"""County assembly bill parsing: Nairobi City County and Trans Nzoia."""
from datetime import date

from app.scripts.sync_county_bills import (
    COUNTIES, identifier_for, merge_acts, parse_assembly_acts, parse_assembly_reports, parse_day, parse_kenya_law_acts,
    parse_nairobi_bills, parse_trans_nzoia_bills, title_key,
)

NAIROBI, TRANS_NZOIA = COUNTIES


def test_nairobi_bills_keep_official_numbers_and_ignore_other_links():
    html = """
    <a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2025/Energy.pdf">The Nairobi City County Clean, Renewable and Sustainable Energy Bill, 2025 (Assembly Bill No.4 of 2025)</a>
    <a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2026/Appropriation.pdf">The Nairobi City County Appropriation Bill 2026</a>
    <a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2021/Plan.pdf">The Nairobi City County Spatial Planning Bill</a>
    <a href="https://elsewhere.example/uploads/bill/2025/x.pdf">The Fake Bill, 2025</a>
    <a href="https://nairobiassembly.go.ke/order-paper/">Order Paper</a>"""
    bills = parse_nairobi_bills(html, NAIROBI.bills_url, NAIROBI)
    by_title = {bill.title: bill for bill in bills}
    energy = by_title["The Nairobi City County Clean, Renewable and Sustainable Energy Bill, 2025"]
    assert (energy.number, energy.year) == (4, 2025)
    assert identifier_for(NAIROBI, energy) == "NCCA/2025/Bill-004"
    assert by_title["The Nairobi City County Appropriation Bill 2026"].year == 2026
    # A title with no year takes the year of the folder the PDF was filed in.
    assert by_title["The Nairobi City County Spatial Planning Bill, 2021"].year == 2021
    assert len(bills) == 3


def test_trans_nzoia_ignores_injected_spam_and_non_bills():
    html = """
    <a href="/index.php/ongoing-passed-bills?download=181:nawiri">the trans nzoia county nawiri fund amendment bill 2023.pdf</a>
    <a href="/index.php/ongoing-passed-bills?download=117:supplement">the_transnzoia_county_subsidiary_legislation2020.pdf</a>
    <a href="/index.php/ongoing-passed-bills?download=90:administration-bill">administration_bill.pdf</a>
    <a href="http://spam.example/porn/x">xxx videos bill.pdf</a>"""
    bills = parse_trans_nzoia_bills(html, TRANS_NZOIA.bills_url, TRANS_NZOIA)
    titles = sorted(bill.title for bill in bills)
    assert titles == ["The Trans Nzoia County Administration Bill", "The Trans Nzoia County Nawiri Fund Amendment Bill, 2023"]
    assert all(bill.document_url.startswith("https://transnzoiaassembly.go.ke/") for bill in bills)


def test_bills_that_became_law_are_matched_to_their_acts():
    html = """<a href="/akn/ke-047/act/2022/4/eng@2023-03-28">Nairobi City County Air Quality Act, 2022</a>
              <a href="/akn/ke-047/act/2014/3/eng@2014-05-19">Nairobi City County Alcoholic Drinks Control and Licensing Act, 2014</a>"""
    acts = parse_kenya_law_acts(html, NAIROBI)
    assert acts[0] == ("Nairobi City County Air Quality Act, 2022", "https://kenyalaw.org/akn/ke-047/act/2022/4/eng@2023-03-28", date(2023, 3, 28))
    bills = parse_nairobi_bills('<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2022/a.pdf">The Nairobi City County Air Quality Bill, 2022</a>'
                                '<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2026/b.pdf">The Nairobi City County Alcoholic Drinks Control and Licensing Bill, 2026</a>',
                                NAIROBI.bills_url, NAIROBI)
    merged = merge_acts(bills, acts)
    by_title = {bill.title: bill for bill in merged}
    assert by_title["The Nairobi City County Air Quality Bill, 2022"].act_date == date(2023, 3, 28)
    # Same name but a different year is a different law: the 2026 bill is not law yet.
    assert by_title["The Nairobi City County Alcoholic Drinks Control and Licensing Bill, 2026"].act_url is None
    assert len(merged) == 3  # the 2014 Act is added on its own


def test_bill_and_act_share_a_title_key():
    assert title_key("The Nairobi City County Air Quality Bill, 2022") == title_key("Nairobi City County Air Quality Act, 2022")


def test_county_bills_without_a_published_stage_are_not_open_yet():
    from app.participation import participation_window
    window = participation_window("Published by the assembly")
    assert window["accepting"] is False and window["status"] == "not_yet_open"
    assert "Clerk's Office" in window["reason"]


ACTS_PAGE = """<table>
<tr><th>#</th><th>Act Title</th><th>Date of Assent</th></tr>
<tr><td>1</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Energy-Act-2026.pdf">The Nairobi City County Clean, Renewable and Sustainable Energy Act 2026</a></td><td>2nd September, 2026</td></tr>
<tr><td>2</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/acts/2014/Gaming.pdf">Nairobi City County Gaming Act, 2014</a></td><td>31st Febtember, 2014</td></tr>
<tr><td>3</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/Finance-Act-2026.pdf">The Nairobi City County Finance Act 2026</a></td><td>1st July, 2026</td></tr>
<tr><td>4</td><td><a href="https://elsewhere.example/uploads/act/2026/x.pdf">The Fake Act 2026</a></td><td>1st July, 2026</td></tr>
<tr><td>5</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/act/2026/notice.pdf">Gazette notice</a></td><td>1st July, 2026</td></tr>
</table>"""


def test_the_assembly_acts_page_gives_each_act_its_pdf_and_date_of_assent():
    acts = parse_assembly_acts(ACTS_PAGE, NAIROBI.acts_url, NAIROBI)
    assert [a[0] for a in acts] == ["The Nairobi City County Clean, Renewable and Sustainable Energy Act 2026",
                                    "Nairobi City County Gaming Act, 2014", "The Nairobi City County Finance Act 2026"]
    assert acts[0][2] == date(2026, 9, 2) and acts[1][2] is None  # a date that cannot be read is left empty
    assert parse_day("8th April, 2026") == date(2026, 4, 8) and parse_day("31st June, 2026") is None and parse_day("") is None


def test_an_act_can_follow_its_bill_by_a_few_years_but_yearly_laws_never_do():
    bills = parse_nairobi_bills(
        '<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2025/e.pdf">The Nairobi City County Clean, Renewable and Sustainable Energy Bill, 2025</a>'
        '<a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/bill/2025/f.pdf">The Nairobi City County Finance Bill, 2025</a>',
        NAIROBI.bills_url, NAIROBI)
    merged = merge_acts(bills, parse_assembly_acts(ACTS_PAGE, NAIROBI.acts_url, NAIROBI), source=NAIROBI.institution)
    by_title = {bill.title: bill for bill in merged}
    energy = by_title["The Nairobi City County Clean, Renewable and Sustainable Energy Bill, 2025"]
    assert energy.act_date == date(2026, 9, 2) and energy.act_source == NAIROBI.institution
    assert by_title["The Nairobi City County Finance Bill, 2025"].act_url is None  # the 2026 Finance Act is a new yearly law
    assert "The Nairobi City County Finance Act 2026" in by_title
    # The assembly's copy replaces Kenya Law's link but keeps Kenya Law's date when it has none.
    kenya_law = merge_acts(bills, [("Nairobi City County Gaming Act, 2014", "https://kenyalaw.org/akn/ke-047/act/2014/9", date(2014, 5, 1))])
    again = {b.title: b for b in merge_acts(kenya_law, parse_assembly_acts(ACTS_PAGE, NAIROBI.acts_url, NAIROBI), source=NAIROBI.institution)}
    gaming = again["Nairobi City County Gaming Act, 2014"]
    assert gaming.act_url.startswith("https://nairobiassembly.go.ke/") and gaming.act_date == date(2014, 5, 1)


PAPERS_PAGE = """<table>
<tr><td>1</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/energy.pdf">THE REPORT OF THE SECTORAL COMMITTEE ON ENERGY AND ICT ON THE CONSIDERATION OF THE NAIROBI CITY COUNTY CLEAN, RENEWABLE AND SUSTAINABLE ENERGY BILL, 2025 (ASSEMBLY BILL NO. 4 OF 2025)</a></td><td>8th April, 2026</td><td>PDF</td></tr>
<tr><td>2</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/pending.pdf">REPORT OF THE AUDITOR-GENERAL ON PENDING BILLS</a></td><td>8th April, 2026</td></tr>
<tr><td>3</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/regs.pdf">THE NAIROBI CITY COUNTY TRANSPORT ACT 2020 BILLBOARDS REGULATIONS 2025</a></td><td>8th April, 2026</td></tr>
<tr><td>4</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/audit.pdf">QUARTER 1 FINANCIAL STATEMENTS</a></td><td>8th April, 2026</td></tr>
<tr><td>5</td><td><a href="https://nairobiassembly.go.ke/ncca/wp-content/uploads/paperlaid/2026/wards.pdf">REPORT OF THE SELECT COMMITTEE ON WARD DEVELOPMENT FUND ON CONSIDERATION OF THE WARDS BILL, 2026, ASSEMBLY BILL NO. 2 OF 2026</a></td><td>23rd June, 2026</td></tr>
</table>"""


def test_committee_reports_on_bills_are_read_from_the_papers_laid_page():
    energy, wards = parse_assembly_reports(PAPERS_PAGE, NAIROBI.reports_url, NAIROBI)
    assert energy["title"].startswith("THE REPORT OF THE SECTORAL COMMITTEE ON ENERGY")
    assert (energy["bill_number"], energy["bill_year"], energy["date_tabled"]) == (4, 2025, date(2026, 4, 8))
    assert energy["committee_name"] == "Sectoral Committee On Energy And Ict" and energy["bill_house"] == "ncca"
    assert (wards["bill_number"], wards["bill_year"]) == (2, 2026)


def test_report_pdfs_come_only_from_official_sites():
    from app.services.ingestion_service import is_official_report_host
    assert is_official_report_host("www.parliament.go.ke") and is_official_report_host("nairobiassembly.go.ke")
    assert not is_official_report_host("nairobiassembly.go.ke.evil.example") and not is_official_report_host(None)
