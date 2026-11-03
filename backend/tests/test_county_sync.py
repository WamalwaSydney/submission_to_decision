"""County assembly bill parsing: Nairobi City County and Trans Nzoia."""
from datetime import date

from app.scripts.sync_county_bills import (
    COUNTIES, identifier_for, merge_acts, parse_kenya_law_acts, parse_nairobi_bills, parse_trans_nzoia_bills, title_key,
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
