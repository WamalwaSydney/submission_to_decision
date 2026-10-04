# Database Seed Script

import asyncio
import uuid
from datetime import datetime, date
from sqlalchemy import select

from app.database import async_session, engine, Base
from app.models import (
    User, LegislativeItem, ParticipationReceipt, CommitteeReport,
    ReportEntry, SubmissionMatch, RepresentativeProfile, NoticeRecord,
    AuditLog
)
from app.auth import get_password_hash

GENESIS_HASH = "0" * 64

async def seed():
    """Seed the database with demo data."""
    
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async with async_session() as session:
        # Check if already seeded
        result = await session.execute(select(User).limit(1))
        if result.first():
            print("Database already seeded. Skipping.")
            return
        
        print("Seeding database...")
        
        # Users (one per role)
        users = [
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000001"), role="citizen", name="Jane Citizen", email="jane@example.com", password_hash=get_password_hash("password123"), status="active"),
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000002"), role="representative", name="Hon. Simulated Rep", email="rep@example.com", password_hash=get_password_hash("password123"), status="active"),
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000003"), role="researcher", name="Dr. Researcher", email="researcher@example.com", password_hash=get_password_hash("password123"), status="active"),
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000004"), role="moderator", name="Mod User", email="mod@example.com", password_hash=get_password_hash("password123"), status="active"),
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000005"), role="administrator", name="Admin User", email="admin@example.com", password_hash=get_password_hash("password123"), status="active"),
            User(id=uuid.UUID("00000000-0000-0000-0000-000000000006"), role="clerk", name="Clerk User", email="clerk@example.com", password_hash=get_password_hash("password123"), status="active"),
        ]
        session.add_all(users)
        
        # Legislative Items (Bills)
        bills = [
            LegislativeItem(id=uuid.UUID("10000000-0000-0000-0000-000000000001"), title="Nairobi Urban Planning (Amendment) Bill, 2026", identifier="NA/2026/Bill-014", institution="National Assembly", stage="Committee Stage", documents=[{"name": "Bill Text (Simulated)"}], status_history=[{"date": "2026-01-10", "stage": "First Reading", "note": "Introduced"}, {"date": "2026-02-01", "stage": "Committee Stage", "note": "Referred to Departmental Committee"}], is_simulated=True),
            LegislativeItem(id=uuid.UUID("10000000-0000-0000-0000-000000000002"), title="Nairobi County Finance Bill, 2026", identifier="NCA/2026/Bill-003", institution="Nairobi County Assembly", stage="Public Participation", documents=[{"name": "Bill Text (Simulated)"}], status_history=[{"date": "2026-02-15", "stage": "First Reading", "note": "Introduced"}, {"date": "2026-03-01", "stage": "Public Participation", "note": "Call for views issued"}], is_simulated=True),
            LegislativeItem(id=uuid.UUID("10000000-0000-0000-0000-000000000003"), title="Trans Nzoia Agriculture Development Bill, 2026", identifier="TNCA/2026/Bill-007", institution="Trans Nzoia County Assembly", stage="Second Reading", documents=[{"name": "Bill Text (Simulated)"}], status_history=[{"date": "2026-01-20", "stage": "First Reading", "note": "Introduced"}, {"date": "2026-02-28", "stage": "Public Participation", "note": "Views collected"}, {"date": "2026-03-15", "stage": "Second Reading", "note": "Committee report tabled"}], is_simulated=True),
            LegislativeItem(id=uuid.UUID("10000000-0000-0000-0000-000000000004"), title="National Health Insurance (Amendment) Bill, 2026", identifier="NA/2026/Bill-022", institution="National Assembly", stage="First Reading", documents=[{"name": "Bill Text (Simulated)"}], status_history=[{"date": "2026-03-01", "stage": "First Reading", "note": "Introduced"}], is_simulated=True),
            LegislativeItem(id=uuid.UUID("10000000-0000-0000-0000-000000000005"), title="Nairobi Traffic Management Bill, 2026", identifier="NCA/2026/Bill-008", institution="Nairobi County Assembly", stage="Committee Stage", documents=[{"name": "Bill Text (Simulated)"}], status_history=[{"date": "2026-02-01", "stage": "First Reading", "note": "Introduced"}, {"date": "2026-02-20", "stage": "Public Participation", "note": "Call for views"}, {"date": "2026-03-10", "stage": "Committee Stage", "note": "Under review"}], is_simulated=True),
        ]
        session.add_all(bills)
        
        # Representative Profiles (11 unclaimed)
        profiles = [
            RepresentativeProfile(id=uuid.UUID("20000000-0000-0000-0000-{:012d}".format(i)), office="Member of Parliament" if i < 3 else "Member of County Assembly", jurisdiction=["Westlands Constituency", "Kamukunji Constituency", "Makadara Constituency", "Starehe Ward", "Pumwani Ward", "Eastleigh North Ward", "Endebess Ward", "Kiminini Ward", "Kwanza Ward", "Matunda Ward", "Soy Ward"][i], institution=["National Assembly", "National Assembly", "National Assembly", "Nairobi County Assembly", "Nairobi County Assembly", "Nairobi County Assembly", "Trans Nzoia County Assembly", "Trans Nzoia County Assembly", "Trans Nzoia County Assembly", "Trans Nzoia County Assembly", "Trans Nzoia County Assembly"][i], committee_membership=[["Finance", "Trade"], ["Health"], ["Lands"], ["Finance & Budget"], ["Health"], ["Lands & Housing"], ["Agriculture"], ["Education"], ["Finance"], ["Infrastructure"], ["Health"]][i], verification_status="unclaimed", profile_label="unclaimed")
            for i in range(11)
        ]
        session.add_all(profiles)
        
        # Participation Receipts
        receipts = [
            ParticipationReceipt(id=uuid.UUID("30000000-0000-0000-0000-000000000001"), public_id="RCT-KN8X2M", author_id=users[0].id, legislative_item_id=bills[0].id, clause_ref="Clause 4", submission_text="The proposed zoning changes in Clause 4 would disproportionately affect small businesses in Westlands. I urge the committee to include a provision for small business relocation assistance.", lodging_status="pending", timestamp=datetime(2026, 2, 5, 10, 30, 0), hash="abc123def456789012345678901234567890123456789012345678901234", previous_hash=GENESIS_HASH),
            ParticipationReceipt(id=uuid.UUID("30000000-0000-0000-0000-000000000002"), public_id="RCT-PQ7Y3N", author_id=users[0].id, legislative_item_id=bills[1].id, submission_text="The proposed market fees increase will hurt informal traders. Please consider a graduated fee structure based on business size.", lodging_status="lodged", timestamp=datetime(2026, 3, 2, 14, 15, 0), hash="def789ghi012345678901234567890123456789012345678901234567890", previous_hash="abc123def456789012345678901234567890123456789012345678901234"),
            ParticipationReceipt(id=uuid.UUID("30000000-0000-0000-0000-000000000003"), public_id="RCT-AB4Z9K", author_id=users[0].id, legislative_item_id=bills[2].id, clause_ref="Clause 7", submission_text="Smallholder farmers in Trans Nzoia need guaranteed access to subsidized fertilizer as proposed in Clause 7, but the eligibility criteria should include cooperatives, not just individual farmers.", lodging_status="acknowledged", timestamp=datetime(2026, 2, 25, 9, 0, 0), hash="ghi345jkl678901234567890123456789012345678901234567890123456", previous_hash="def789ghi012345678901234567890123456789012345678901234567890"),
            ParticipationReceipt(id=uuid.UUID("30000000-0000-0000-0000-000000000004"), public_id="RCT-MN5C1P", author_id=users[0].id, legislative_item_id=bills[0].id, submission_text="Environmental impact assessments should be mandatory before any zoning change takes effect, as per the constitutional right to a clean environment.", lodging_status="pending", timestamp=datetime(2026, 2, 8, 16, 45, 0), hash="jkl901mno234567890123456789012345678901234567890123456789012", previous_hash="ghi345jkl678901234567890123456789012345678901234567890123456"),
            ParticipationReceipt(id=uuid.UUID("30000000-0000-0000-0000-000000000005"), public_id="RCT-WX6D8R", author_id=users[0].id, legislative_item_id=bills[4].id, submission_text="The traffic management plan should prioritize pedestrian safety near schools and hospitals in Nairobi.", lodging_status="pending", timestamp=datetime(2026, 2, 22, 11, 20, 0), hash="mno567pqr890123456789012345678901234567890123456789012345678", previous_hash="jkl901mno234567890123456789012345678901234567890123456789012"),
        ]
        session.add_all(receipts)
        
        # Committee Reports
        reports = [
            CommitteeReport(id=uuid.UUID("40000000-0000-0000-0000-000000000001"), bill_ref=bills[2].id, institution="Trans Nzoia County Assembly", date_tabled=date(2026, 3, 15), source_document_ref="TNCA-Report-2026-007.pdf", extraction_status="verified", ocr_used=False, is_simulated=True),
            CommitteeReport(id=uuid.UUID("40000000-0000-0000-0000-000000000002"), bill_ref=bills[0].id, institution="National Assembly", date_tabled=date(2026, 3, 20), source_document_ref="NA-Report-2026-014.pdf", extraction_status="needs_review", ocr_used=True, is_simulated=True),
        ]
        session.add_all(reports)
        
        # Report Entries
        entries = [
            ReportEntry(id=uuid.UUID("50000000-0000-0000-0000-000000000001"), report_ref=reports[0].id, clause_ref="Clause 7", extracted_summary="Submissions from smallholder farmers requesting cooperative eligibility for subsidized fertilizer access.", treatment="amended", stated_reason="Committee agreed to expand eligibility to include registered cooperatives."),
            ReportEntry(id=uuid.UUID("50000000-0000-0000-0000-000000000002"), report_ref=reports[0].id, clause_ref="Clause 12", extracted_summary="Views on establishing county-level agricultural extension offices.", treatment="adopted", stated_reason="Committee adopted the recommendation."),
            ReportEntry(id=uuid.UUID("50000000-0000-0000-0000-000000000003"), report_ref=reports[0].id, clause_ref="Clause 3", extracted_summary="Concerns about land use changes affecting farming communities.", treatment="rejected with reasons", stated_reason="Committee found the concerns outside the scope of this bill."),
            ReportEntry(id=uuid.UUID("50000000-0000-0000-0000-000000000004"), report_ref=reports[1].id, clause_ref="Clause 4", extracted_summary="Views on small business relocation assistance for zoning changes.", treatment="not addressed"),
        ]
        session.add_all(entries)
        
        # Submission Matches
        matches = [
            SubmissionMatch(id=uuid.UUID("60000000-0000-0000-0000-000000000001"), receipt_ref=receipts[2].id, report_entry_ref=entries[0].id, match_method="clause", confidence_score=0.95, explanation="Exact clause reference match: both reference Clause 7 of the Trans Nzoia Agriculture Development Bill.", reviewer_decision="confirmed", reviewer_id=users[3].id, timestamp=datetime(2026, 3, 16, 10, 0, 0)),
            SubmissionMatch(id=uuid.UUID("60000000-0000-0000-0000-000000000002"), receipt_ref=receipts[0].id, report_entry_ref=entries[3].id, match_method="text-similarity", confidence_score=0.72, explanation="Text similarity: submission discusses 'small business relocation' which matches the report entry about 'small business relocation assistance for zoning changes'. Key tokens: small business, relocation, zoning.", reviewer_decision="confirmed", reviewer_id=users[3].id, timestamp=datetime(2026, 3, 21, 14, 30, 0)),
            SubmissionMatch(id=uuid.UUID("60000000-0000-0000-0000-000000000003"), receipt_ref=receipts[3].id, report_entry_ref=entries[3].id, match_method="text-similarity", confidence_score=0.45, explanation="Weak text similarity: submission mentions 'environmental impact' and 'zoning change' but report entry focuses on business relocation.", reviewer_decision="pending", timestamp=datetime(2026, 3, 21, 14, 35, 0)),
        ]
        session.add_all(matches)
        
        # Notice Records
        notices = [
            NoticeRecord(id=uuid.UUID("70000000-0000-0000-0000-000000000001"), bill_ref=bills[0].id, institution="National Assembly", notice_date=date(2026, 2, 1), window_start=date(2026, 2, 1), window_end=date(2026, 2, 28), mode="Gazette notice + website", bill_text_accessible=True),
            NoticeRecord(id=uuid.UUID("70000000-0000-0000-0000-000000000002"), bill_ref=bills[1].id, institution="Nairobi County Assembly", notice_date=date(2026, 3, 1), window_start=date(2026, 3, 1), window_end=date(2026, 3, 21), mode="Newspaper + public baraza", bill_text_accessible=True),
            NoticeRecord(id=uuid.UUID("70000000-0000-0000-0000-000000000003"), bill_ref=bills[2].id, institution="Trans Nzoia County Assembly", notice_date=date(2026, 2, 15), window_start=date(2026, 2, 15), window_end=date(2026, 3, 7), mode="Radio announcement + chief baraza", bill_text_accessible=False),
            NoticeRecord(id=uuid.UUID("70000000-0000-0000-0000-000000000004"), bill_ref=bills[4].id, institution="Nairobi County Assembly", notice_date=date(2026, 2, 20), window_start=date(2026, 2, 20), window_end=date(2026, 3, 12), mode="Website + social media", bill_text_accessible=True),
        ]
        session.add_all(notices)
        
        # Audit Log
        audit_entries = [
            AuditLog(entity_type="receipt", entity_id=receipts[0].id, action="created", details=f"Receipt {receipts[0].public_id} issued for {bills[0].id}", timestamp=receipts[0].timestamp),
            AuditLog(entity_type="receipt", entity_id=receipts[1].id, action="created", details=f"Receipt {receipts[1].public_id} issued for {bills[1].id}", timestamp=receipts[1].timestamp),
            AuditLog(entity_type="receipt", entity_id=receipts[2].id, action="created", details=f"Receipt {receipts[2].public_id} issued for {bills[2].id}", timestamp=receipts[2].timestamp),
            AuditLog(entity_type="match", entity_id=matches[0].id, action="confirmed", details="Match confirmed by moderator", timestamp=matches[0].timestamp),
            AuditLog(entity_type="match", entity_id=matches[1].id, action="confirmed", details="Match confirmed by moderator", timestamp=matches[1].timestamp),
        ]
        session.add_all(audit_entries)
        
        await session.commit()
        print("✓ Database seeded successfully!")
        print(f"  - {len(users)} users")
        print(f"  - {len(bills)} bills")
        print(f"  - {len(profiles)} profiles")
        print(f"  - {len(receipts)} receipts")
        print(f"  - {len(reports)} reports")
        print(f"  - {len(entries)} report entries")
        print(f"  - {len(matches)} matches")
        print(f"  - {len(notices)} notices")
        print(f"  - {len(audit_entries)} audit log entries")

if __name__ == "__main__":
    asyncio.run(seed())
