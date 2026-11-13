import { apiFetch, apiFetchBlob } from './client';
import { ReceiptVerification, User } from '../types';

export interface LoginResponse { access_token: string; token_type: string; user: User; }
export type SignupRole = 'citizen' | 'committee_officer' | 'reviewer' | 'administrator';
export interface SignupOptions {
  committee_id?: string;
  institution?: string;
  notification_language?: 'en' | 'sw';
}
export interface RegisterResponse {
  access_token?: string;
  token_type?: string;
  user?: User;
  status?: 'pending_approval';
  message?: string;
  recovery_codes?: string[];
}
export interface BootstrapResponse {
  bills: any[];
  committees: any[];
  receipts: any[];
  reports: any[];
  report_entries: any[];
  matches: any[];
  notices: any[];
  profiles: any[];
}

export type ReportDecision = 'adopted' | 'amended' | 'rejected' | 'not addressed';
export interface ReportSubmissionItem {
  entry_id: string;
  clause_ref?: string | null;
  stakeholder: string;
  issue: string;
  decision: ReportDecision;
  reason: string;
  report_id: string;
  report_title: string;
}
export interface PlatformCounts { submissions: number; confirmed: number; rejected: number; pending: number; }
export interface ReportAnalysisSummary {
  model: string;
  generated_at: string | null;
  reports_analysed: number;
  submissions_recorded: number;
  decisions: Record<ReportDecision, number>;
  summary: string | null;
}
export type ActStatus = 'in_act' | 'not_in_act' | 'unclear';
/** Whether one recommendation the committee adopted made it into the final Act. */
export interface FinalActItem {
  key: string; // `${report_id}:${entry_id}`
  status: ActStatus;
  section: string | null;
  quote: string | null;
  quote_verified: boolean;
  act_span?: string | null; // the matching wording exactly as it appears in the Act
  removed_wording?: string | null; // for deletions: wording in the bill as published that the Act no longer has
  evidence?: 'quote' | 'changed' | 'kept' | 'removed' | null;
  verdict?: 'yes' | 'partly';
  verdict_reason?: string;
  explanation: string;
}
export type HouseDecision = 'agreed' | 'unchanged' | 'negatived' | 'withdrawn' | 'not_found' | 'unclear';
/** What the House did with one recommendation, in the Committee of the Whole House. */
export interface HouseItem {
  key: string;
  decision: HouseDecision;
  clause: string | null;
  excerpt: string | null;
  sitting: { id: number; url: string; title: string } | null;
  explanation: string;
  supported?: boolean;
  verdict?: 'yes' | 'partly';
  verdict_reason?: string;
}
export interface HouseTrace {
  sittings: { id: number; url: string; title: string }[];
  found: boolean;
  model: string | null;
  checked_at: string | null;
  counts: Record<HouseDecision, number> | null;
  items: HouseItem[];
  source: string;
}
/** A platform receipt's path once a moderator confirms it matches a committee report entry. */
export interface ReceiptTrace {
  key: string;
  bill_id: string;
  bill_stage: string;
  committee: ReportSubmissionItem | null;
  house: HouseItem | null;
  house_source: string | null;
  act: FinalActItem | null;
  final_act: { title: string | null; citation: string | null; url: string | null; has_text: boolean } | null;
}
export interface FinalAct {
  title: string | null;
  citation: string | null;
  url: string | null;
  has_text: boolean;
  model: string | null;
  checked_at: string | null;
  counts: Record<ActStatus, number> | null;
  checked: number;
  items: FinalActItem[];
}
export interface FinalActText {
  bill: { id: string; title: string; identifier: string };
  act: FinalAct;
  has_pdf: boolean;
  text: string;
  recommendations: Record<string, ReportSubmissionItem>;
}
export interface ParticipationSummary {
  bill_id: string;
  platform: PlatformCounts;
  reports: number;
  report_analysis: (ReportAnalysisSummary & { items: ReportSubmissionItem[]; submitters?: Record<string, string[]> }) | null;
  final_act: FinalAct | null;
  house: HouseTrace | null;
  platform_links?: Record<string, string[]>;
  ai_available: boolean;
}
export interface ParticipationOutcomeRow {
  id: string; title: string; identifier: string; institution: string; stage: string; passed: boolean;
  platform: PlatformCounts;
  report: ReportAnalysisSummary | null;
}

export const api = {
  bootstrap: () => apiFetch<BootstrapResponse>('/bootstrap'),
  committees: () => apiFetch<{ committees: any[] }>('/committees'),
  createCommittee: (data: { name: string; institution: string; description?: string; contact_email?: string; account_name?: string; account_email?: string; account_password?: string }) => apiFetch<any>('/committees', { method: 'POST', body: JSON.stringify(data) }),
  setBillCommittee: (billId: string, committeeId: string | null) => apiFetch<{ bill: any }>(`/bills/${encodeURIComponent(billId)}/committee`, { method: 'PUT', body: JSON.stringify({ committee_id: committeeId }) }),
  confirmBillCommittees: (billIds: string[]) => apiFetch<{ confirmed: number }>('/bills/committee/confirm', { method: 'POST', body: JSON.stringify({ bill_ids: billIds }) }),
  committeeBills: () => apiFetch<{ bills: any[] }>('/committees/me/bills'),
  ingestBill: (data: { title: string; identifier: string; stage: string; source_url?: string; file?: File | null }) => {
    const form = new FormData();
    form.append('title', data.title);
    form.append('identifier', data.identifier);
    form.append('stage', data.stage);
    if (data.source_url) form.append('source_url', data.source_url);
    if (data.file) form.append('file', data.file);
    return apiFetch<any>('/committees/me/bills', { method: 'POST', body: form });
  },
  billFlow: (billId: string) => apiFetch<any>(`/bills/${encodeURIComponent(billId)}/flow`),
  participationSummary: (billId: string) => apiFetch<ParticipationSummary>(`/bills/${encodeURIComponent(billId)}/participation-summary`),
  generateParticipationSummary: (billId: string) => apiFetch<ParticipationSummary>(`/bills/${encodeURIComponent(billId)}/participation-summary/generate`, { method: 'POST' }),
  uploadFinalAct: (billId: string, file: File, actUrl?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (actUrl) form.append('act_url', actUrl);
    return apiFetch<ParticipationSummary>(`/bills/${encodeURIComponent(billId)}/final-act`, { method: 'POST', body: form });
  },
  finalActText: (billId: string) => apiFetch<FinalActText>(`/bills/${encodeURIComponent(billId)}/final-act/text`),
  checkFinalAct: (billId: string) => apiFetch<ParticipationSummary>(`/bills/${encodeURIComponent(billId)}/final-act/check`, { method: 'POST' }),
  participationOutcomes: (passedOnly = false) => apiFetch<{ bills: ParticipationOutcomeRow[] }>(`/participation-outcomes${passedOnly ? '?passed_only=true' : ''}`),
  users: () => apiFetch<{ users: User[] }>('/users'),
  updateUser: (userId: string, data: { role: User['role']; status: User['status']; committee_id?: string }) => apiFetch<any>(`/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(data) }),
  approveCommitteeOfficer: (userId: string, committeeId: string) => apiFetch<any>(`/users/${encodeURIComponent(userId)}/approve-committee-officer`, { method: 'POST', body: JSON.stringify({ committee_id: committeeId }) }),
  generateRecoveryCodes: (current_password: string) => apiFetch<{ recovery_codes: string[]; message: string }>('/auth/recovery-codes', { method: 'POST', body: JSON.stringify({ current_password }) }),
  resetWithRecoveryCode: (data: { email: string; recovery_code: string; password: string }) => apiFetch<{ message: string }>('/auth/password-reset/recovery-code', { method: 'POST', body: JSON.stringify(data) }),
  issuePasswordReset: (userId: string) => apiFetch<{ reset_code: string; expires_at: string; message: string }>(`/users/${encodeURIComponent(userId)}/password-reset`, { method: 'POST' }),
  resetPassword: (token: string, password: string) => apiFetch<{ message: string }>('/auth/password-reset/complete', { method: 'POST', body: JSON.stringify({ token, password }) }),
  login: (email: string, password: string) => apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string, role: SignupRole, options: SignupOptions = {}) => apiFetch<RegisterResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role, ...options }) }),
  me: () => apiFetch<{ user: User }>('/auth/me'),
  bills: () => apiFetch<{ bills: any[] }>('/bills'),
  receipt: (publicId: string) => apiFetch<any>(`/receipts/${encodeURIComponent(publicId)}`),
  myReceipts: () => apiFetch<{ receipts: any[] }>('/receipts/my'),
  reviewQueueReceipts: () => apiFetch<{ receipts: any[] }>('/receipts/review-queue'),
  createReceipt: (data: { legislative_item_id: string; clause_ref?: string; submission_text: string; show_name_publicly: boolean; document?: File | null }) => {
    const form = new FormData();
    form.append('legislative_item_id', data.legislative_item_id);
    if (data.clause_ref) form.append('clause_ref', data.clause_ref);
    form.append('submission_text', data.submission_text);
    form.append('show_name_publicly', String(data.show_name_publicly));
    if (data.document) form.append('document', data.document);
    return apiFetch<any>('/receipts', { method: 'POST', body: form });
  },
  updateReceipt: (publicId: string, data: { clause_ref?: string; submission_text: string; show_name_publicly: boolean; document?: File | null; remove_document?: boolean }) => {
    const form = new FormData();
    if (data.clause_ref) form.append('clause_ref', data.clause_ref);
    form.append('submission_text', data.submission_text);
    form.append('show_name_publicly', String(data.show_name_publicly));
    if (data.document) form.append('document', data.document);
    form.append('remove_document', String(Boolean(data.remove_document)));
    return apiFetch<any>(`/receipts/${encodeURIComponent(publicId)}`, { method: 'PUT', body: form });
  },
  myReceiptForBill: (billId: string) => apiFetch<{ receipt: any | null }>(`/receipts/mine/${encodeURIComponent(billId)}`),
  downloadReceiptDocument: (publicId: string) => apiFetchBlob(`/receipts/${encodeURIComponent(publicId)}/document`),
  verifyChain: () => apiFetch<any>('/receipts/verify'),
  verifyReceipt: (publicId: string) => apiFetch<ReceiptVerification>(`/receipts/${encodeURIComponent(publicId.trim())}/verify`),
  uploadReport: (file: File, billRef: string, institution: string, dateTabled: string, sourceUrl?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('bill_ref', billRef);
    form.append('institution', institution);
    form.append('date_tabled', dateTabled);
    if (sourceUrl) form.append('source_url', sourceUrl);
    return apiFetch<any>('/reports/upload', { method: 'POST', body: form });
  },
  pendingMatches: () => apiFetch<{ matches: any[] }>('/matches/pending'),
  autoProcessMatches: () => apiFetch<{ bills_processed: number; proposals_created: number }>('/matches/auto-process', { method: 'POST' }),
  generateMatches: (billRef: string) => apiFetch<{ matches: any[] }>(`/reports/${encodeURIComponent(billRef)}/generate-matches`, { method: 'POST' }),
  retryReportExtraction: (reportId: string) => apiFetch<{ report: any; entries_extracted: number; matches: any[] }>(`/reports/${encodeURIComponent(reportId)}/retry-extraction`, { method: 'POST' }),
  decideMatch: (matchId: string, decision: 'confirm' | 'reject', reason?: string) => apiFetch<any>(`/matches/${matchId}/${decision}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  report: (reportId: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}`),
  updateReportEntry: (reportId: string, entryId: string, treatment: string, statedReason?: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}/entries/${encodeURIComponent(entryId)}`, { method: 'PUT', body: JSON.stringify({ treatment, stated_reason: statedReason }) }),
  verifyReport: (reportId: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}/verify`, { method: 'PUT' }),
  claimProfile: (profileId: string) => apiFetch<any>(`/profiles/${profileId}/claim`, { method: 'POST' }),
  verifyProfile: (profileId: string, status: string) => { const form = new FormData(); form.append('status', status); return apiFetch<any>(`/profiles/${profileId}/verify`, { method: 'POST', body: form }); },
  createNotice: (data: Record<string, string | boolean>) => { const form = new FormData(); Object.entries(data).forEach(([k, v]) => form.append(k, String(v))); return apiFetch<any>('/notices', { method: 'POST', body: form }); },
  updateNotice: (noticeId: string, data: Record<string, string | boolean>) => { const form = new FormData(); Object.entries(data).forEach(([k, v]) => form.append(k, String(v))); return apiFetch<any>(`/notices/${encodeURIComponent(noticeId)}`, { method: 'PUT', body: form }); },
  reportContent: (contentType: string, contentId: string, reason: string) => { const form = new FormData(); form.append('content_type', contentType); form.append('content_id', contentId); form.append('reason', reason); return apiFetch<any>('/reports/content', { method: 'POST', body: form }); },
  moderationCases: () => apiFetch<{ cases: any[] }>('/moderation/cases'),
  decideModerationCase: (caseId: string, decision: 'upheld' | 'dismissed') => { const form = new FormData(); form.append('decision', decision); return apiFetch<any>(`/moderation/cases/${encodeURIComponent(caseId)}`, { method: 'PUT', body: form }); },
  exportAnonymized: () => apiFetch<any>('/export/anonymized'),
  messages: () => apiFetch<{ messages: any[] }>('/messages'),
  updateNotificationLanguage: (language: 'en' | 'sw') => apiFetch<{ notification_language: 'en' | 'sw' }>('/messages/preferences', { method: 'PUT', body: JSON.stringify({ language }) }),
  markAllMessagesRead: () => apiFetch<{ marked: number }>('/messages/read-all', { method: 'PUT' }),
  markMessageRead: (messageId: string) => apiFetch<any>(`/messages/${encodeURIComponent(messageId)}/read`, { method: 'PUT' }),
};
