# Database Models

from sqlalchemy import Column, String, Text, Boolean, Float, Date, DateTime, ForeignKey, ARRAY, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role = Column(String(20), nullable=False)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    privacy_prefs = Column(JSON, default={"show_name_publicly": False})
    status = Column(String(20), default="active")
    created_date = Column(DateTime(timezone=True), server_default=func.now())

    receipts = relationship("ParticipationReceipt", back_populates="author")
    profiles = relationship(
        "RepresentativeProfile",
        foreign_keys="RepresentativeProfile.user_id",
        back_populates="user",
    )
class LegislativeItem(Base):
    __tablename__ = "legislative_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(500), nullable=False)
    identifier = Column(String(100), unique=True, nullable=False)
    institution = Column(String(100), nullable=False)
    stage = Column(String(100), nullable=False)
    documents = Column(JSON, default=[])
    status_history = Column(JSON, default=[])
    is_simulated = Column(Boolean, default=False)

    receipts = relationship("ParticipationReceipt", back_populates="legislative_item")
    reports = relationship("CommitteeReport", back_populates="bill")
    notices = relationship("NoticeRecord", back_populates="bill")

class ParticipationReceipt(Base):
    __tablename__ = "participation_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_id = Column(String(20), unique=True, nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    legislative_item_id = Column(UUID(as_uuid=True), ForeignKey("legislative_items.id"), nullable=False)
    clause_ref = Column(String(100))
    submission_text = Column(Text, nullable=False)
    lodging_status = Column(String(20), default="pending")
    timestamp = Column(DateTime(timezone=True), nullable=False)
    hash = Column(String(64), nullable=False)
    previous_hash = Column(String(64), nullable=False)
    author_name_public = Column(String(255))

    author = relationship("User", back_populates="receipts")
    legislative_item = relationship("LegislativeItem", back_populates="receipts")
    matches = relationship("SubmissionMatch", back_populates="receipt")

class CommitteeReport(Base):
    __tablename__ = "committee_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_ref = Column(UUID(as_uuid=True), ForeignKey("legislative_items.id"), nullable=False)
    institution = Column(String(100), nullable=False)
    date_tabled = Column(Date, nullable=False)
    source_document_ref = Column(String(500), nullable=False)
    extraction_status = Column(String(20), default="pending")
    ocr_used = Column(Boolean, default=False)
    is_simulated = Column(Boolean, default=False)

    bill = relationship("LegislativeItem", back_populates="reports")
    entries = relationship("ReportEntry", back_populates="report")

class ReportEntry(Base):
    __tablename__ = "report_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_ref = Column(UUID(as_uuid=True), ForeignKey("committee_reports.id"), nullable=False)
    clause_ref = Column(String(100), nullable=False)
    extracted_summary = Column(Text, nullable=False)
    treatment = Column(String(30), nullable=False)
    stated_reason = Column(Text)

    report = relationship("CommitteeReport", back_populates="entries")
    matches = relationship("SubmissionMatch", back_populates="report_entry")

class SubmissionMatch(Base):
    __tablename__ = "submission_matches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_ref = Column(UUID(as_uuid=True), ForeignKey("participation_receipts.id"), nullable=False)
    report_entry_ref = Column(UUID(as_uuid=True), ForeignKey("report_entries.id"), nullable=False)
    match_method = Column(String(20), nullable=False)
    confidence_score = Column(Float, nullable=False)
    explanation = Column(Text, nullable=False)
    reviewer_decision = Column(String(20), default="pending")
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    receipt = relationship("ParticipationReceipt", back_populates="matches")
    report_entry = relationship("ReportEntry", back_populates="matches")

class RepresentativeProfile(Base):
    __tablename__ = "representative_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    office = Column(String(255), nullable=False)
    jurisdiction = Column(String(255), nullable=False)
    institution = Column(String(100), nullable=False)
    committee_membership = Column(ARRAY(Text), default=[])
    verification_status = Column(String(30), default="unclaimed")
    profile_label = Column(String(20), default="unclaimed")
    verifier_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    contact_channels = Column(JSON, default=[])
    created_date = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship(
        "User",
        foreign_keys=[user_id],
        back_populates="profiles",
    )
    verifier = relationship("User", foreign_keys=[verifier_id])
class NoticeRecord(Base):
    __tablename__ = "notice_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bill_ref = Column(UUID(as_uuid=True), ForeignKey("legislative_items.id"), nullable=False)
    institution = Column(String(100), nullable=False)
    notice_date = Column(Date, nullable=False)
    window_start = Column(Date, nullable=False)
    window_end = Column(Date, nullable=False)
    mode = Column(String(255), nullable=False)
    bill_text_accessible = Column(Boolean, default=False)

    bill = relationship("LegislativeItem", back_populates="notices")

class ModerationAction(Base):
    __tablename__ = "moderation_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reporter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content_type = Column(String(20), nullable=False)
    content_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(Text, nullable=False)
    decision = Column(String(20), default="pending")
    moderator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    appeal_status = Column(String(20), default="none")
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String(50), nullable=False)
    details = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
