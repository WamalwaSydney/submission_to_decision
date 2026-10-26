// Canonical outcome statuses plus an explicit label for report text awaiting classification.
// A confirmed submission match is treated as adopted unless an explicit
// committee treatment overrides it.

export type SubmissionStatus = 
  | 'awaiting committee report'
  | 'adopted'
  | 'amended'
  | 'rejected with reasons'
  | 'not addressed'
  | 'unclassified';

export type RepresentativeStatus = 
  | 'unclaimed'
  | 'verified and active'
  | 'verified but inactive';

export type ProfileLabel = 'verified' | 'pilot' | 'unclaimed';

export type ExtractionStatus = 
  | 'pending'
  | 'extracting'
  | 'extracted'
  | 'ocr_used'
  | 'needs_review'
  | 'verified';

export type MatchMethod = 'clause' | 'text-similarity' | 'llm';

export type ReviewerDecision = 'confirmed' | 'rejected' | 'pending';

export type UserRole =
  | 'citizen'
  | 'committee_officer'
  | 'reviewer'
  | 'moderator'
  | 'administrator';

export type Institution = 
  | 'National Assembly'
  | 'Nairobi County Assembly'
  | 'Trans Nzoia County Assembly';

export type LodgingStatus = 'pending' | 'lodged' | 'acknowledged' | 'not_applicable';

// Data entities from §5

export interface User {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  status: 'active' | 'suspended' | 'pending_approval';
  committee_id?: string;
  notification_language?: 'en' | 'sw';
  created_date: string;
  recovery_codes_configured?: boolean;
}

export interface Committee {
  id: string;
  name: string;
  institution: Institution;
  description?: string;
  contact_email?: string;
  status: string;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_user_id?: string;
  committee_id?: string;
  bill_id?: string;
  receipt_id?: string;
  subject: string;
  body: string;
  message_type: string;
  sender_type?: 'user' | 'system';
  language?: 'en' | 'sw';
  generation_source?: 'gemini' | 'template';
  is_read: boolean;
  created_at: string;
}

export interface RepresentativeProfile {
  id: string;
  user_id?: string;
  office: string;
  jurisdiction: string;
  institution: Institution;
  committee_membership: string[];
  verification_status: RepresentativeStatus;
  profile_label: ProfileLabel;
  verifier_id?: string;
  contact_channels: { type: string; value: string }[];
  created_date: string;
}

export interface LegislativeItem {
  id: string;
  title: string;
  identifier: string;
  institution: Institution;
  stage: string;
  documents: { name: string; url?: string }[];
  source_updated_at?: string;
  stage_as_at?: string;
  bill_house?: string;
  bill_number?: number;
  bill_year?: number;
  status_history: { date: string; stage: string; note: string }[];
  is_simulated: boolean;
  committee_id?: string;
}

export interface ParticipationReceipt {
  id: string;
  public_id: string; // short, human-typeable
  author_id: string;
  legislative_item_id: string;
  clause_ref?: string;
  submission_text: string;
  lodging_status: LodgingStatus;
  timestamp: string;
  hash: string;
  previous_hash: string;
  author_name_public?: string; // optional per privacy_prefs
}

export interface CommitteeReport {
  id: string;
  bill_ref: string;
  institution: Institution;
  date_tabled: string;
  source_document_ref: string;
  source_url?: string;
  source_verification_status?: 'verified' | 'unverified';
  source_verification_label?: string;
  bill_house?: string;
  bill_number?: number;
  bill_year?: number;
  title?: string;
  extraction_status: ExtractionStatus;
  ocr_used: boolean;
  is_simulated: boolean;
}

export interface ReportEntry {
  id: string;
  report_ref: string;
  clause_ref: string;
  extracted_summary: string;
  treatment: SubmissionStatus;
  stated_reason?: string;
}

export interface SubmissionMatch {
  id: string;
  receipt_ref: string;
  report_entry_ref: string;
  match_method: MatchMethod;
  confidence_score: number;
  explanation: string;
  reviewer_decision: ReviewerDecision;
  reviewer_reason?: string;
  reviewer_id?: string;
  timestamp: string;
}

export interface NoticeRecord {
  id: string;
  bill_ref: string;
  institution: Institution;
  notice_date: string;
  window_start: string;
  window_end: string;
  mode: string;
  bill_text_accessible: boolean;
}

export interface ModerationAction {
  id: string;
  reporter_id: string;
  content_type: 'receipt' | 'profile' | 'report_entry';
  content_id: string;
  reason: string;
  decision: 'pending' | 'upheld' | 'dismissed';
  reviewer_id?: string;
  appeal_status: 'none' | 'appealed' | 'resolved';
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface OfflineDraft {
  id: string;
  legislative_item_id: string;
  clause_ref?: string;
  submission_text: string;
  created_at: string;
  synced: boolean;
}

export interface ChainVerificationResult {
  valid: boolean;
  firstBrokenIndex?: number;
  totalChecked: number;
  details: { index: number; receiptId: string; valid: boolean; expectedHash: string; actualHash: string }[];
}
