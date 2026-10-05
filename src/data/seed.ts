import { 
  LegislativeItem, ParticipationReceipt, CommitteeReport, ReportEntry, 
  SubmissionMatch, NoticeRecord, RepresentativeProfile, User, 
  ModerationAction, AuditLogEntry, Institution 
} from '../types';

// Genesis hash for the chain (first receipt's previous_hash)
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// Seed users (one per role, all labeled simulated)
export const seedUsers: User[] = [
  { id: 'u-citizen-001', role: 'citizen', name: 'Jane Citizen', email: 'jane@example.com', status: 'active', created_date: '2026-01-15T08:00:00Z' },
  { id: 'u-rep-001', role: 'representative', name: 'Hon. Simulated Rep', email: 'rep@example.com', status: 'active', created_date: '2026-01-10T08:00:00Z' },
  { id: 'u-researcher-001', role: 'researcher', name: 'Dr. Researcher', email: 'researcher@example.com', status: 'active', created_date: '2026-01-12T08:00:00Z' },
  { id: 'u-moderator-001', role: 'moderator', name: 'Mod User', email: 'mod@example.com', status: 'active', created_date: '2026-01-08T08:00:00Z' },
  { id: 'u-admin-001', role: 'administrator', name: 'Admin User', email: 'admin@example.com', status: 'active', created_date: '2026-01-05T08:00:00Z' },
  { id: 'u-clerk-001', role: 'clerk', name: 'Clerk User', email: 'clerk@example.com', status: 'active', created_date: '2026-01-06T08:00:00Z' },
];

// Seed legislative items (bills) - clearly marked simulated
export const seedBills: LegislativeItem[] = [
  {
    id: 'bill-001', title: 'Nairobi Urban Planning (Amendment) Bill, 2026', identifier: 'NA/2026/Bill-014',
    institution: 'National Assembly', stage: 'Committee Stage',
    documents: [{ name: 'Bill Text (Simulated)', url: '#' }, { name: 'Memorandum (Simulated)', url: '#' }],
    status_history: [
      { date: '2026-01-10', stage: 'First Reading', note: 'Introduced' },
      { date: '2026-02-01', stage: 'Committee Stage', note: 'Referred to Departmental Committee' },
    ],
    is_simulated: true
  },
  {
    id: 'bill-002', title: 'Nairobi County Finance Bill, 2026', identifier: 'NCA/2026/Bill-003',
    institution: 'Nairobi County Assembly', stage: 'Public Participation',
    documents: [{ name: 'Bill Text (Simulated)', url: '#' }],
    status_history: [
      { date: '2026-02-15', stage: 'First Reading', note: 'Introduced' },
      { date: '2026-03-01', stage: 'Public Participation', note: 'Call for views issued' },
    ],
    is_simulated: true
  },
  {
    id: 'bill-003', title: 'Trans Nzoia Agriculture Development Bill, 2026', identifier: 'TNCA/2026/Bill-007',
    institution: 'Trans Nzoia County Assembly', stage: 'Second Reading',
    documents: [{ name: 'Bill Text (Simulated)', url: '#' }],
    status_history: [
      { date: '2026-01-20', stage: 'First Reading', note: 'Introduced' },
      { date: '2026-02-28', stage: 'Public Participation', note: 'Views collected' },
      { date: '2026-03-15', stage: 'Second Reading', note: 'Committee report tabled' },
    ],
    is_simulated: true
  },
  {
    id: 'bill-004', title: 'National Health Insurance (Amendment) Bill, 2026', identifier: 'NA/2026/Bill-022',
    institution: 'National Assembly', stage: 'First Reading',
    documents: [{ name: 'Bill Text (Simulated)', url: '#' }],
    status_history: [
      { date: '2026-03-01', stage: 'First Reading', note: 'Introduced' },
    ],
    is_simulated: true
  },
  {
    id: 'bill-005', title: 'Nairobi Traffic Management Bill, 2026', identifier: 'NCA/2026/Bill-008',
    institution: 'Nairobi County Assembly', stage: 'Committee Stage',
    documents: [{ name: 'Bill Text (Simulated)', url: '#' }],
    status_history: [
      { date: '2026-02-01', stage: 'First Reading', note: 'Introduced' },
      { date: '2026-02-20', stage: 'Public Participation', note: 'Call for views' },
      { date: '2026-03-10', stage: 'Committee Stage', note: 'Under review' },
    ],
    is_simulated: true
  },
];

// Seed representative profiles (≥10 offices, all unclaimed)
export const seedProfiles: RepresentativeProfile[] = [
  { id: 'prof-001', office: 'Member of Parliament', jurisdiction: 'Westlands Constituency', institution: 'National Assembly', committee_membership: ['Finance', 'Trade'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-002', office: 'Member of Parliament', jurisdiction: 'Kamukunji Constituency', institution: 'National Assembly', committee_membership: ['Health'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-003', office: 'Member of Parliament', jurisdiction: 'Makadara Constituency', institution: 'National Assembly', committee_membership: ['Lands'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-004', office: 'Member of County Assembly', jurisdiction: 'Starehe Ward', institution: 'Nairobi County Assembly', committee_membership: ['Finance & Budget'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-005', office: 'Member of County Assembly', jurisdiction: 'Pumwani Ward', institution: 'Nairobi County Assembly', committee_membership: ['Health'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-006', office: 'Member of County Assembly', jurisdiction: 'Eastleigh North Ward', institution: 'Nairobi County Assembly', committee_membership: ['Lands & Housing'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-007', office: 'Member of County Assembly', jurisdiction: 'Endebess Ward', institution: 'Trans Nzoia County Assembly', committee_membership: ['Agriculture'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-008', office: 'Member of County Assembly', jurisdiction: 'Kiminini Ward', institution: 'Trans Nzoia County Assembly', committee_membership: ['Education'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-009', office: 'Member of County Assembly', jurisdiction: 'Kwanza Ward', institution: 'Trans Nzoia County Assembly', committee_membership: ['Finance'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-010', office: 'Member of County Assembly', jurisdiction: 'Matunda Ward', institution: 'Trans Nzoia County Assembly', committee_membership: ['Infrastructure'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
  { id: 'prof-011', office: 'Member of County Assembly', jurisdiction: 'Soy Ward', institution: 'Trans Nzoia County Assembly', committee_membership: ['Health'], verification_status: 'unclaimed', profile_label: 'unclaimed', contact_channels: [], created_date: '2026-01-10T08:00:00Z' },
];

// Seed receipts
export const seedReceipts: ParticipationReceipt[] = [
  { id: 'r-001', public_id: 'RCT-KN8X2M', author_id: 'u-citizen-001', legislative_item_id: 'bill-001', clause_ref: 'Clause 4', submission_text: 'The proposed zoning changes in Clause 4 would disproportionately affect small businesses in Westlands. I urge the committee to include a provision for small business relocation assistance.', lodging_status: 'pending', timestamp: '2026-02-05T10:30:00Z', hash: 'f340beef5df870f58a269a44c3f1428107068974d0aeb3e48780437cf2da5f27', previous_hash: GENESIS_HASH, author_name_public: undefined },
  { id: 'r-002', public_id: 'RCT-PQ7Y3N', author_id: 'u-citizen-001', legislative_item_id: 'bill-002', submission_text: 'The proposed market fees increase will hurt informal traders. Please consider a graduated fee structure based on business size.', lodging_status: 'lodged', timestamp: '2026-03-02T14:15:00Z', hash: 'ba7df7b83a3c4866a747331ff47517a1678529dfdab04db7ebd0fca2bb7e8fe1', previous_hash: 'f340beef5df870f58a269a44c3f1428107068974d0aeb3e48780437cf2da5f27', author_name_public: undefined },
  { id: 'r-003', public_id: 'RCT-AB4Z9K', author_id: 'u-citizen-001', legislative_item_id: 'bill-003', clause_ref: 'Clause 7', submission_text: 'Smallholder farmers in Trans Nzoia need guaranteed access to subsidized fertilizer as proposed in Clause 7, but the eligibility criteria should include cooperatives, not just individual farmers.', lodging_status: 'acknowledged', timestamp: '2026-02-25T09:00:00Z', hash: '3f139982d77c24cdf85b95280f3d81f8834633c072e113e9d981ec014aeebbb5', previous_hash: 'ba7df7b83a3c4866a747331ff47517a1678529dfdab04db7ebd0fca2bb7e8fe1', author_name_public: undefined },
  { id: 'r-004', public_id: 'RCT-MN5C1P', author_id: 'u-citizen-001', legislative_item_id: 'bill-001', submission_text: 'Environmental impact assessments should be mandatory before any zoning change takes effect, as per the constitutional right to a clean environment.', lodging_status: 'pending', timestamp: '2026-02-08T16:45:00Z', hash: '7a52efd29b8e636750c3caba9bdcead002b25d462f6946172b61b6716e30da80', previous_hash: '3f139982d77c24cdf85b95280f3d81f8834633c072e113e9d981ec014aeebbb5', author_name_public: undefined },
  { id: 'r-005', public_id: 'RCT-WX6D8R', author_id: 'u-citizen-001', legislative_item_id: 'bill-005', submission_text: 'The traffic management plan should prioritize pedestrian safety near schools and hospitals in Nairobi.', lodging_status: 'pending', timestamp: '2026-02-22T11:20:00Z', hash: '99caa477c27ee1448e5a6f974aec2669ceb5adba0eacab1f644951ee1f734f07', previous_hash: '7a52efd29b8e636750c3caba9bdcead002b25d462f6946172b61b6716e30da80', author_name_public: undefined },
];

// Seed committee reports
export const seedReports: CommitteeReport[] = [
  { id: 'rpt-001', bill_ref: 'bill-003', institution: 'Trans Nzoia County Assembly', date_tabled: '2026-03-15', source_document_ref: 'TNCA-Report-2026-007.pdf', extraction_status: 'verified', ocr_used: false, is_simulated: true },
  { id: 'rpt-002', bill_ref: 'bill-001', institution: 'National Assembly', date_tabled: '2026-03-20', source_document_ref: 'NA-Report-2026-014.pdf', extraction_status: 'needs_review', ocr_used: true, is_simulated: true },
];

// Seed report entries
export const seedReportEntries: ReportEntry[] = [
  { id: 're-001', report_ref: 'rpt-001', clause_ref: 'Clause 7', extracted_summary: 'Submissions from smallholder farmers requesting cooperative eligibility for subsidized fertilizer access.', treatment: 'amended', stated_reason: 'Committee agreed to expand eligibility to include registered cooperatives.' },
  { id: 're-002', report_ref: 'rpt-001', clause_ref: 'Clause 12', extracted_summary: 'Views on establishing county-level agricultural extension offices.', treatment: 'adopted', stated_reason: 'Committee adopted the recommendation.' },
  { id: 're-003', report_ref: 'rpt-001', clause_ref: 'Clause 3', extracted_summary: 'Concerns about land use changes affecting farming communities.', treatment: 'rejected with reasons', stated_reason: 'Committee found the concerns outside the scope of this bill.' },
  { id: 're-004', report_ref: 'rpt-002', clause_ref: 'Clause 4', extracted_summary: 'Views on small business relocation assistance for zoning changes.', treatment: 'not addressed' },
];

// Seed submission matches
export const seedMatches: SubmissionMatch[] = [
  { id: 'm-001', receipt_ref: 'r-003', report_entry_ref: 're-001', match_method: 'clause', confidence_score: 0.95, explanation: 'Exact clause reference match: both reference Clause 7 of the Trans Nzoia Agriculture Development Bill.', reviewer_decision: 'confirmed', reviewer_id: 'u-moderator-001', timestamp: '2026-03-16T10:00:00Z' },
  { id: 'm-002', receipt_ref: 'r-001', report_entry_ref: 're-004', match_method: 'text-similarity', confidence_score: 0.72, explanation: 'Text similarity: submission discusses "small business relocation" which matches the report entry about "small business relocation assistance for zoning changes". Key tokens: small business, relocation, zoning.', reviewer_decision: 'confirmed', reviewer_id: 'u-moderator-001', timestamp: '2026-03-21T14:30:00Z' },
  { id: 'm-003', receipt_ref: 'r-004', report_entry_ref: 're-004', match_method: 'text-similarity', confidence_score: 0.45, explanation: 'Weak text similarity: submission mentions "environmental impact" and "zoning change" but report entry focuses on business relocation.', reviewer_decision: 'pending', timestamp: '2026-03-21T14:35:00Z' },
];

// Seed notice records
export const seedNotices: NoticeRecord[] = [
  { id: 'n-001', bill_ref: 'bill-001', institution: 'National Assembly', notice_date: '2026-02-01', window_start: '2026-02-01', window_end: '2026-02-28', mode: 'Gazette notice + website', bill_text_accessible: true },
  { id: 'n-002', bill_ref: 'bill-002', institution: 'Nairobi County Assembly', notice_date: '2026-03-01', window_start: '2026-03-01', window_end: '2026-03-21', mode: 'Newspaper + public baraza', bill_text_accessible: true },
  { id: 'n-003', bill_ref: 'bill-003', institution: 'Trans Nzoia County Assembly', notice_date: '2026-02-15', window_start: '2026-02-15', window_end: '2026-03-07', mode: 'Radio announcement + chief baraza', bill_text_accessible: false },
  { id: 'n-004', bill_ref: 'bill-005', institution: 'Nairobi County Assembly', notice_date: '2026-02-20', window_start: '2026-02-20', window_end: '2026-03-12', mode: 'Website + social media', bill_text_accessible: true },
];

// Seed moderation actions
export const seedModerationActions: ModerationAction[] = [
  { id: 'mod-001', reporter_id: 'u-citizen-001', content_type: 'profile', content_id: 'prof-001', reason: 'Suspected impersonation - profile claims to represent a real person without verification', decision: 'pending', appeal_status: 'none', timestamp: '2026-03-10T09:00:00Z' },
];

// Seed audit log
export const seedAuditLog: AuditLogEntry[] = [
  { id: 'al-001', entity_type: 'receipt', entity_id: 'r-001', action: 'created', details: 'Receipt RCT-KN8X2M issued for bill-001', timestamp: '2026-02-05T10:30:00Z' },
  { id: 'al-002', entity_type: 'receipt', entity_id: 'r-002', action: 'created', details: 'Receipt RCT-PQ7Y3N issued for bill-002', timestamp: '2026-03-02T14:15:00Z' },
  { id: 'al-003', entity_type: 'receipt', entity_id: 'r-003', action: 'created', details: 'Receipt RCT-AB4Z9K issued for bill-003', timestamp: '2026-02-25T09:00:00Z' },
  { id: 'al-004', entity_type: 'match', entity_id: 'm-001', action: 'confirmed', details: 'Match confirmed by moderator u-moderator-001', timestamp: '2026-03-16T10:00:00Z' },
  { id: 'al-005', entity_type: 'match', entity_id: 'm-002', action: 'confirmed', details: 'Match confirmed by moderator u-moderator-001', timestamp: '2026-03-21T14:30:00Z' },
];

// Utility functions
export function getDaysOfNotice(notice: NoticeRecord): number {
  const noticeDate = new Date(notice.notice_date);
  const windowStart = new Date(notice.window_start);
  return Math.ceil((windowStart.getTime() - noticeDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function getWindowLength(notice: NoticeRecord): number {
  const start = new Date(notice.window_start);
  const end = new Date(notice.window_end);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function generatePublicId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'RCT-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
