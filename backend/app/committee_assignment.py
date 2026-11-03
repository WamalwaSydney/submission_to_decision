"""Which committee handles a bill.

Where an official source names the committee, that wins: the bill's sponsor is a
committee chairperson (Bills Tracker), a committee report on the bill, or a call
for memoranda. Parliament's trackers do not otherwise say which committee a bill
was committed to, so for the rest the bill is assigned by subject, following the
subject areas each departmental (or county sectoral) committee covers. Those
assignments are labelled "subject matter" and shown as awaiting confirmation;
an administrator can confirm or change them, and the sync never overrides an
administrator's choice.

``committee_assignment_source`` values:
  official record  – named by Parliament or the assembly
  subject matter   – suggested from the bill's title
  administrator    – set or confirmed by an administrator
"""
from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import text

log = logging.getLogger(__name__)

OFFICIAL = "official record"
SUBJECT = "subject matter"
ADMIN = "administrator"

# Subject areas, most specific first (ties go to the earlier topic).
TOPICS: list[tuple[str, re.Pattern]] = [(topic, re.compile(pattern, re.I)) for topic, pattern in [
    ("budget", r"appropriation|division of revenue|allocation of revenue|equali[sz]ation fund|additional allocations"),
    ("cdf", r"constituencies development fund|ng-?cdf"),
    ("wards", r"wards? development"),
    ("regional", r"regional development|lake basin|coast development|kerio valley|ewaso"),
    ("cohesion", r"cohesion|equal opportunit|hate speech"),
    ("defence", r"\bdefen[cs]e\b|intelligence|foreign (service|relations)|diplomat"),
    ("tourism", r"touris|wildlife|hotel"),
    ("fisheries", r"fisher|aquacultur|blue economy"),
    ("health", r"health|medic|hospital|pharmac|nurs(e|ing)|mental|cancer|\bhiv\b|tobacco|breastfeed|nutrition|clinical|ambulance|drugs|harm reduction|prosthetist|orthotist|optometr|dentist|physiotherap"),
    ("education", r"educat|universit|school|teacher|vocational|polytechnic|learner|student|early childhood|bursary|elimu|kenya institute of curriculum"),
    ("agriculture", r"agricultur|\bcrops?\b|livestock|dairy|\btea\b|coffee|sugar|cotton|seeds?\b|fertili|veterinar|animal|food security|pest|warehouse receipt|\bfarm|maize|horticultur|irish potato|miraa"),
    ("water", r"\bwater|irrigation|sanitation|sewer"),
    ("energy", r"energy|petroleum|electric|nuclear|geothermal|\boil\b|natural gas"),
    ("environment", r"environment|forest|mining|climate change|natural resources|plastic|waste|air quality|noise|pollution|meteorolog|sustainable development"),
    ("lands", r"\bland|survey|valuer|spatial planning|physical and land use|sectional properties|unauthori[sz]ed development|eviction|resettlement|demolition"),
    ("housing", r"housing|urban|\bbuilding|estate agent|architect|built environment"),
    ("transport", r"transport|\broads?\b|traffic|railway|aviation|\bports?\b|shipping|maritime|motorcycle|boda|parking|public works|air passenger|airport"),
    ("ict", r"information|communication|\bict\b|data protection|cyber|computer|\bmedia\b|postal|digital|innovation|start-?up|content creat|national addressing"),
    ("trade", r"\btrade\b|industr|co-?operative|sacco|competition|investment|export|weights and measures|standards|special economic zones|micro and small|counterfeit|business|consumer|\bmarkets?\b|licens|price control|intellectual property|copyright|trademark"),
    ("labour", r"labour|employment|occupational safety|work injury|wages?\b|industrial relations|trade union|public service"),
    ("social", r"social (protection|welfare|assistance)|children|disabilit|older persons|elderly|street famil|sign language|affirmative|youth|women|gender|widow|family"),
    ("culture", r"sport|culture|heritage|music|\bfilm|creative|museum|kiswahili|talent|\barts?\b"),
    ("justice", r"constitution|judicat|judicial|courts?\b|election|electoral|\biebc\b|political parties|statute law|law reform|advocates|magistrate|attorney|legal aid|witness|corruption|ethics|integrity|proceeds of crime|treaty|succession|marriage|privileges|public participation|county assembly services|coroner|legal|offences|contract|economic and social rights"),
    ("security", r"police|security|firearm|prison|immigration|citizenship|refugee|registration of persons|narcotic|public order|disaster|emergenc|\bfire\b|enforcement|alcoholic|criminal investigation|national government coordination"),
    ("finance", r"financ|\btax|value added|excise|customs|insurance|\bbank|capital markets|retirement benefits|pension|statistic|national planning|privati[sz]|public debt|procurement|revenue|\brating\b|fees and charges|betting|lotter|gaming|microfinance|unclaimed|money laundering|levies|levy"),
]]

# Committee that covers each subject, per legislature. Names match the
# committee records (National Assembly names come from the Parliament sync).
NATIONAL_ASSEMBLY = "National Assembly"
NAIROBI = "Nairobi City County Assembly"
TRANS_NZOIA = "Trans Nzoia County Assembly"

COMMITTEES_BY_TOPIC = {
    NATIONAL_ASSEMBLY: {
        "budget": "Budget and Appropriations Committee", "finance": "Finance and National Planning", "health": "Health",
        "education": "Education", "agriculture": "Agriculture and Livestock", "water": "Blue Economy, Water and Irrigation",
        "fisheries": "Blue Economy, Water and Irrigation", "environment": "Environment, Forestry and Mining", "energy": "Energy",
        "lands": "Lands", "housing": "Housing, Urban Planning and Public works", "transport": "Transport and Infrastructure",
        "ict": "Communication, Information and Innovation", "trade": "Trade, Industry and Cooperatives", "tourism": "Tourism and Wildlife",
        "labour": "Labour", "social": "Social Protection", "culture": "Sports and Culture", "justice": "Justice and Legal Affairs Committee",
        "security": "Administration and Internal Security", "defence": "Defence, Intelligence and Foreign Relations",
        "cohesion": "National Cohesion and Equal Opportunity", "regional": "Regional Development Committee",
        "cdf": "National Government Constituencies Development Fund Committee",
    },
    NAIROBI: {
        "budget": "County Finance, Budget and Appropriations", "finance": "County Finance, Budget and Appropriations",
        "health": "Health Services", "education": "Children, Early Childhood Education and Vocational Training",
        "agriculture": "Agriculture, Livestock and Fisheries", "fisheries": "Agriculture, Livestock and Fisheries",
        "water": "Water and Sanitation", "environment": "Environment and Natural Resources",
        "energy": "Energy and Information, Communications and Technology", "ict": "Energy and Information, Communications and Technology",
        "lands": "Lands, Planning and Housing", "housing": "Lands, Planning and Housing", "transport": "Transport and Public Works",
        "trade": "Trade, Tourism and Cooperatives", "tourism": "Trade, Tourism and Cooperatives",
        "labour": "Labour and Social Welfare", "social": "Labour and Social Welfare", "culture": "Culture and Community Services",
        "justice": "Justice and Legal Affairs", "wards": "Wards Development Fund",
    },
    TRANS_NZOIA: {
        "budget": "County Budget and Appropriation", "finance": "Finance and Economic Planning", "health": "Health Services",
        "education": "ICT, Early Childhood Education and Vocational Training", "ict": "ICT, Early Childhood Education and Vocational Training",
        "agriculture": "Agriculture", "fisheries": "Agriculture", "water": "Water, Environment and Natural Resources",
        "environment": "Water, Environment and Natural Resources", "lands": "Lands, Housing, Physical Planning and Urban Development",
        "housing": "Lands, Housing, Physical Planning and Urban Development", "transport": "Transport and Public Works",
        "trade": "Trade, Commerce, Industry and Cooperatives", "tourism": "Trade, Commerce, Industry and Cooperatives",
        "labour": "Labour and Social Welfare", "social": "Children and Community Services", "culture": "Gender, Culture and Sports",
        "justice": "Justice and Legal Affairs", "security": "Security and Disaster Management",
    },
}

# County committees, from each assembly's own published list. Committee names
# are unique on the platform, so county committees carry their county's name.
COUNTY_COMMITTEES = {
    NAIROBI: ("Nairobi", "https://nairobiassembly.go.ke/committee-types/sectorial/"),
    TRANS_NZOIA: ("Trans Nzoia", "http://transnzoiaassembly.go.ke/downloads/committes.pdf"),
}


def platform_committee_name(institution: str, name: str) -> str:
    county = COUNTY_COMMITTEES.get(institution)
    return f"{name} ({county[0]})" if county else name


def suggest_topic(title: str) -> str | None:
    """The subject area a bill's title points to, or None if it is unclear."""
    scores = []
    for order, (topic, pattern) in enumerate(TOPICS):
        hits = len(pattern.findall(title or ""))
        if hits:
            scores.append((-hits, order, topic))
    return min(scores)[2] if scores else None


def suggest_committee(institution: str, title: str) -> str | None:
    topic = suggest_topic(title)
    name = COMMITTEES_BY_TOPIC.get(institution, {}).get(topic) if topic else None
    return platform_committee_name(institution, name) if name else None


async def ensure_county_committees(conn) -> int:
    """Create the county committees named on each assembly's published list."""
    created = 0
    for institution, (_, source) in COUNTY_COMMITTEES.items():
        for name in sorted(set(COMMITTEES_BY_TOPIC[institution].values())):
            full = platform_committee_name(institution, name)
            exists = (await conn.execute(text("SELECT 1 FROM committees WHERE name=:name"), {"name": full})).first()
            if exists:
                continue
            await conn.execute(text(
                "INSERT INTO committees (id, name, institution, description, status) VALUES (:id, :name, :institution, :description, 'active')"),
                {"id": uuid.uuid4(), "name": full, "institution": institution, "description": f"Committee of the {institution}. Source: {source}"})
            created += 1
    return created


async def assign_committees(conn) -> dict:
    """Fill in committees for bills that have none, or only a subject-matter guess."""
    committees = {row[1]: row[0] for row in (await conn.execute(text("SELECT id, name FROM committees"))).fetchall()}
    stats = {"official record": 0, "subject matter": 0, "unclear": 0}
    rows = (await conn.execute(text(
        "SELECT id, title, institution, committee_id, committee_assignment_source FROM legislative_items "
        "WHERE is_simulated = false AND (committee_id IS NULL OR committee_assignment_source = :subject)"),
        {"subject": SUBJECT})).fetchall()
    for bill_id, title, institution, current, source in rows:
        # Official evidence first: a committee report on this bill.
        report_committees = {row[0] for row in (await conn.execute(text(
            "SELECT DISTINCT committee_name FROM committee_reports WHERE bill_ref=:id AND committee_name IS NOT NULL"), {"id": bill_id})).fetchall()}
        official = next(iter(report_committees)) if len(report_committees) == 1 else None
        official_id = next((cid for name, cid in committees.items() if official and name.casefold() == official.casefold()), None)
        if official_id:
            await conn.execute(text("UPDATE legislative_items SET committee_id=:c, committee_assignment_source=:s WHERE id=:id"),
                               {"c": official_id, "s": OFFICIAL, "id": bill_id})
            stats[OFFICIAL] += 1
            continue
        suggestion = suggest_committee(institution, title)
        suggestion_id = committees.get(suggestion) if suggestion else None
        if suggestion_id is None:
            stats["unclear"] += 1
            continue
        if suggestion_id != current or source != SUBJECT:
            await conn.execute(text("UPDATE legislative_items SET committee_id=:c, committee_assignment_source=:s WHERE id=:id"),
                               {"c": suggestion_id, "s": SUBJECT, "id": bill_id})
        stats[SUBJECT] += 1
    log.info("Committee assignment: %s", stats)
    return stats
