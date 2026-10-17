import { apiFetch } from './client';
import { User } from '../types';

export interface LoginResponse { access_token: string; token_type: string; user: User; }
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

export const api = {
  bootstrap: () => apiFetch<BootstrapResponse>('/bootstrap'),
  committees: () => apiFetch<{ committees: any[] }>('/committees'),
  createCommittee: (data: { name: string; institution: string; description?: string; contact_email?: string; account_name: string; account_email: string; account_password: string }) => apiFetch<any>('/committees', { method: 'POST', body: JSON.stringify(data) }),
  committeeBills: () => apiFetch<{ bills: any[] }>('/committees/me/bills'),
  ingestBill: (data: { title: string; identifier: string; stage: string; source_url?: string }) => apiFetch<any>('/committees/me/bills', { method: 'POST', body: JSON.stringify(data) }),
  billFlow: (billId: string) => apiFetch<any>(`/bills/${encodeURIComponent(billId)}/flow`),
  users: () => apiFetch<{ users: User[] }>('/users'),
  login: (email: string, password: string) => apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string, role: 'citizen' | 'representative') => apiFetch<LoginResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role }) }),
  me: () => apiFetch<{ user: User }>('/auth/me'),
  bills: () => apiFetch<{ bills: any[] }>('/bills'),
  receipt: (publicId: string) => apiFetch<any>(`/receipts/${encodeURIComponent(publicId)}`),
  myReceipts: () => apiFetch<{ receipts: any[] }>('/receipts/my'),
  createReceipt: (data: { legislative_item_id: string; clause_ref?: string; submission_text: string; show_name_publicly: boolean }) => {
    const form = new FormData();
    form.append('legislative_item_id', data.legislative_item_id);
    if (data.clause_ref) form.append('clause_ref', data.clause_ref);
    form.append('submission_text', data.submission_text);
    form.append('show_name_publicly', String(data.show_name_publicly));
    return apiFetch<any>('/receipts', { method: 'POST', body: form });
  },
  verifyChain: () => apiFetch<any>('/receipts/verify'),
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
  generateMatches: (billRef: string) => apiFetch<{ matches: any[] }>(`/reports/${encodeURIComponent(billRef)}/generate-matches`, { method: 'POST' }),
  decideMatch: (matchId: string, decision: 'confirm' | 'reject') => apiFetch<any>(`/matches/${matchId}/${decision}`, { method: 'POST' }),
  report: (reportId: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}`),
  updateReportEntry: (reportId: string, entryId: string, treatment: string, statedReason?: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}/entries/${encodeURIComponent(entryId)}`, { method: 'PUT', body: JSON.stringify({ treatment, stated_reason: statedReason }) }),
  verifyReport: (reportId: string) => apiFetch<any>(`/reports/${encodeURIComponent(reportId)}/verify`, { method: 'PUT' }),
  claimProfile: (profileId: string) => apiFetch<any>(`/profiles/${profileId}/claim`, { method: 'POST' }),
  verifyProfile: (profileId: string, status: string) => { const form = new FormData(); form.append('status', status); return apiFetch<any>(`/profiles/${profileId}/verify`, { method: 'POST', body: form }); },
  createNotice: (data: Record<string, string | boolean>) => { const form = new FormData(); Object.entries(data).forEach(([k, v]) => form.append(k, String(v))); return apiFetch<any>('/notices', { method: 'POST', body: form }); },
  reportContent: (contentType: string, contentId: string, reason: string) => { const form = new FormData(); form.append('content_type', contentType); form.append('content_id', contentId); form.append('reason', reason); return apiFetch<any>('/reports/content', { method: 'POST', body: form }); },
  moderationCases: () => apiFetch<{ cases: any[] }>('/moderation/cases'),
  exportAnonymized: () => apiFetch<any>('/export/anonymized'),
  messages: () => apiFetch<{ messages: any[] }>('/messages'),
  sendMessage: (data: { recipient_user_id?: string; committee_id?: string; bill_id?: string; receipt_id?: string; subject: string; body: string; message_type?: string }) => apiFetch<any>('/messages', { method: 'POST', body: JSON.stringify(data) }),
  markMessageRead: (messageId: string) => apiFetch<any>(`/messages/${encodeURIComponent(messageId)}/read`, { method: 'PUT' }),
};
