// Exact status vocabulary from §6 - DO NOT add synonyms or extra statuses

export type SubmissionStatus = 
  | 'awaiting committee report'
  | 'adopted'
  | 'amended'
  | 'rejected with reasons'
  | 'not addressed';

export type RepresentativeStatus = 
  | 'unclaimed'
  | 'verified and active'
  | 'verified but inactive';

export type ProfileLabel = 'verified' | 'pilot' | 'simulated' | 'unclaimed';

export type ExtractionStatus = 
  | 'pending'
  | 'extracted'
  | 'ocr_used'
  | 'needs_review'
  | 'verified';

export type MatchMethod = 'clause' | 'text-similarity';

export type ReviewerDecision = 'confirmed' | 'rejected' | 'pending';

export type UserRole = 
  | 'citizen'
  | 'representative'
  | 'researcher'
  | 'moderator'
  | 'administrator'
  | 'clerk';

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
  status: 'active' | 'suspended';
  created_date: string;
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
  status_history: { date: string; stage: string; note: string }[];
  is_simulated: boolean;
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
  moderator_id?: string;
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
