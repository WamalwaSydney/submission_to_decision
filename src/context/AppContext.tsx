import React, { createContext, useContext, useEffect, useMemo, useReducer, ReactNode } from 'react';
import {
  User, LegislativeItem, ParticipationReceipt, CommitteeReport,
  ReportEntry, SubmissionMatch, NoticeRecord, RepresentativeProfile,
  ModerationAction, AuditLogEntry, UserRole, SubmissionStatus,
  RepresentativeStatus, ReviewerDecision, LodgingStatus, Committee
} from '../types';
import { api } from '../api/endpoints';
import { STAGE_ORDER, SubmissionStage, submissionStage } from '../utils/submissionStage';

interface AppState {
  users: User[];
  committees: Committee[];
  bills: LegislativeItem[];
  receipts: ParticipationReceipt[];
  reports: CommitteeReport[];
  reportEntries: ReportEntry[];
  matches: SubmissionMatch[];
  notices: NoticeRecord[];
  profiles: RepresentativeProfile[];
  moderationActions: ModerationAction[];
  auditLog: AuditLogEntry[];
  currentUser: User | null;
  isOnline: boolean;
  isLoading: boolean;
  apiError?: string;
}

type Action =
  | { type: 'HYDRATE'; payload: Partial<AppState> }
  | { type: 'SET_API_ERROR'; payload: string }
  | { type: 'ADD_RECEIPT'; payload: ParticipationReceipt }
  | { type: 'REPLACE_RECEIPT'; payload: { previousId: string; receipt: ParticipationReceipt } }
  | { type: 'ADD_AUDIT_LOG'; payload: AuditLogEntry }
  | { type: 'ADD_REPORT'; payload: CommitteeReport }
  | { type: 'ADD_REPORT_ENTRIES'; payload: ReportEntry[] }
  | { type: 'ADD_MATCH'; payload: SubmissionMatch }
  | { type: 'UPSERT_MATCH'; payload: SubmissionMatch }
  | { type: 'UPDATE_MATCH_DECISION'; payload: { matchId: string; decision: ReviewerDecision; reviewerId: string } }
  | { type: 'ADD_NOTICE'; payload: NoticeRecord }
  | { type: 'UPDATE_NOTICE'; payload: NoticeRecord }
  | { type: 'UPDATE_REPORT_STATUS'; payload: { reportId: string; status: CommitteeReport['extraction_status'] } }
  | { type: 'CLAIM_PROFILE'; payload: { profileId: string; userId: string } }
  | { type: 'VERIFY_PROFILE'; payload: { profileId: string; verifierId: string; status: RepresentativeStatus } }
  | { type: 'UPDATE_RECEIPT_LODGING'; payload: { receiptId: string; status: LodgingStatus } }
  | { type: 'ADD_MODERATION'; payload: ModerationAction }
  | { type: 'UPDATE_MODERATION'; payload: { id: string; decision: ModerationAction['decision']; reviewerId: string } }
  | { type: 'ADD_USER'; payload: User }
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'UPDATE_REPORT_ENTRY'; payload: { entryId: string; treatment: SubmissionStatus; stated_reason?: string } };

const initialState: AppState = {
  users: [],
  committees: [],
  bills: [],
  receipts: [],
  reports: [],
  reportEntries: [],
  matches: [],
  notices: [],
  profiles: [],
  moderationActions: [],
  auditLog: [],
  currentUser: null,
  isOnline: true,
  isLoading: true,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
      // Partial refreshes (e.g. one bill's reports) must not end the initial load.
      return { ...state, ...action.payload, isLoading: action.payload.bills ? false : state.isLoading, apiError: undefined };
    case 'SET_API_ERROR':
      return {
        ...state,
        isLoading: false,
        apiError: action.payload,
      };
    case 'ADD_RECEIPT':
      return { ...state, receipts: [...state.receipts.filter(r => r.id !== action.payload.id), action.payload] };
    case 'REPLACE_RECEIPT':
      // An edit supersedes the earlier version; only the current one is shown.
      return {
        ...state,
        receipts: [...state.receipts.filter(r => r.id !== action.payload.previousId && r.id !== action.payload.receipt.id), action.payload.receipt],
        matches: state.matches.filter(m => m.receipt_ref !== action.payload.previousId || m.reviewer_decision !== 'pending'),
      };
    case 'ADD_AUDIT_LOG':
      return { ...state, auditLog: [...state.auditLog, action.payload] };
    case 'ADD_REPORT':
      return { ...state, reports: [...state.reports, action.payload] };
    case 'ADD_REPORT_ENTRIES':
      return { ...state, reportEntries: [...state.reportEntries, ...action.payload] };
    case 'ADD_MATCH':
      return { ...state, matches: [...state.matches, action.payload] };
    case 'UPSERT_MATCH':
      return {
        ...state,
        matches: state.matches.some(m => m.id === action.payload.id)
          ? state.matches.map(m => m.id === action.payload.id ? { ...m, ...action.payload } : m)
          : [...state.matches, action.payload],
      };
    case 'UPDATE_MATCH_DECISION':
      return {
        ...state,
        matches: state.matches.map(m =>
          m.id === action.payload.matchId
            ? { ...m, reviewer_decision: action.payload.decision, reviewer_id: action.payload.reviewerId, timestamp: new Date().toISOString() }
            : m
        ),
      };
    case 'ADD_NOTICE':
      return { ...state, notices: [...state.notices, action.payload] };
    case 'UPDATE_NOTICE':
      return { ...state, notices: state.notices.map(notice => notice.id === action.payload.id ? action.payload : notice) };
    case 'UPDATE_REPORT_STATUS':
      return {
        ...state,
        reports: state.reports.map(r =>
          r.id === action.payload.reportId ? { ...r, extraction_status: action.payload.status } : r
        ),
      };
    case 'CLAIM_PROFILE':
      return {
        ...state,
        profiles: state.profiles.map(p =>
          p.id === action.payload.profileId ? { ...p, user_id: action.payload.userId } : p
        ),
      };
    case 'VERIFY_PROFILE':
      return {
        ...state,
        profiles: state.profiles.map(p =>
          p.id === action.payload.profileId
            ? { ...p, verification_status: action.payload.status, verifier_id: action.payload.verifierId, profile_label: 'verified' as const }
            : p
        ),
      };
    case 'UPDATE_RECEIPT_LODGING':
      return {
        ...state,
        receipts: state.receipts.map(r =>
          r.id === action.payload.receiptId ? { ...r, lodging_status: action.payload.status } : r
        ),
      };
    case 'ADD_MODERATION':
      return { ...state, moderationActions: [...state.moderationActions, action.payload] };
    case 'UPDATE_MODERATION':
      return {
        ...state,
        moderationActions: state.moderationActions.map(m =>
          m.id === action.payload.id ? { ...m, decision: action.payload.decision, reviewer_id: action.payload.reviewerId } : m
        ),
      };
    case 'ADD_USER':
      return { ...state, users: [...state.users, action.payload] };
    case 'SET_USER':
      return { ...state, currentUser: action.payload };
    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload };
    case 'UPDATE_REPORT_ENTRY':
      return {
        ...state,
        reportEntries: state.reportEntries.map(e =>
          e.id === action.payload.entryId
            ? { ...e, treatment: action.payload.treatment, stated_reason: action.payload.stated_reason || e.stated_reason }
            : e
        ),
      };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getSubmissionStatus: (receiptId: string) => SubmissionStage;
  getSubmissionReviewDecision: (receiptId: string) => ReviewerDecision | null;
  getSubmissionLodgingStatus: (receiptId: string) => LodgingStatus;
  getBillOutcomes: (billId: string) => { status: SubmissionStage; count: number }[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Clerk's Office accounts only see their own committee's records: its bills,
 * their reports and report entries, calls for views, submissions and matches.
 * Every page reads this scoped view, so none can show another committee's work.
 */
function scopeToCommittee(state: AppState): AppState {
  const user = state.currentUser;
  if (!user || user.role !== 'committee_officer') return state;
  const ownBills = state.bills.filter(bill => Boolean(user.committee_id) && bill.committee_id === user.committee_id);
  const billIds = new Set(ownBills.map(bill => bill.id));
  const reports = state.reports.filter(report => billIds.has(report.bill_ref));
  const reportIds = new Set(reports.map(report => report.id));
  const receipts = state.receipts.filter(receipt => billIds.has(receipt.legislative_item_id));
  const receiptIds = new Set(receipts.map(receipt => receipt.id));
  return {
    ...state,
    bills: ownBills,
    reports,
    reportEntries: state.reportEntries.filter(entry => reportIds.has(entry.report_ref)),
    receipts,
    matches: state.matches.filter(match => receiptIds.has(match.receipt_ref)),
    notices: state.notices.filter(notice => billIds.has(notice.bill_ref)),
    committees: state.committees.filter(committee => committee.id === user.committee_id),
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [fullState, dispatch] = useReducer(reducer, initialState);
  const state = useMemo(() => scopeToCommittee(fullState), [fullState]);

  useEffect(() => {
    let cancelled = false;
    api.bootstrap().then(data => {
      if (cancelled) return;
      dispatch({ type: 'HYDRATE', payload: {
        bills: data.bills,
        committees: data.committees || [],
        receipts: data.receipts,
        reports: data.reports,
        reportEntries: data.report_entries,
        matches: data.matches,
        notices: data.notices,
        profiles: data.profiles,
      } });
    }).catch(error => {
      if (!cancelled) dispatch({ type: 'SET_API_ERROR', payload: error instanceof Error ? error.message : 'Unable to load API data' });
    });
    const savedUser = localStorage.getItem('current_user');
    if (savedUser) {
      try { dispatch({ type: 'SET_USER', payload: JSON.parse(savedUser) as User }); } catch { localStorage.removeItem('current_user'); }
    }
    return () => { cancelled = true; };
  }, []);

  // Where each submission is in its journey: received → with the committee →
  // report published → response under review → outcome.
  const getSubmissionStatus = (receiptId: string): SubmissionStage => {
    const receipt = state.receipts.find(r => r.id === receiptId);
    const bill = receipt ? state.bills.find(b => b.id === receipt.legislative_item_id) : undefined;
    return submissionStage({
      receiptId,
      matches: state.matches,
      entries: state.reportEntries,
      reportPublished: Boolean(bill && state.reports.some(report => report.bill_ref === bill.id)),
      acceptingViews: bill?.participation?.accepting ?? true,
    });
  };

  const getSubmissionReviewDecision = (receiptId: string): ReviewerDecision | null => {
    const matches = state.matches.filter(match => match.receipt_ref === receiptId);
    return matches.find(match => match.reviewer_decision === 'confirmed')?.reviewer_decision
      || matches.find(match => match.reviewer_decision === 'pending')?.reviewer_decision
      || matches.find(match => match.reviewer_decision === 'rejected')?.reviewer_decision
      || null;
  };

  const getSubmissionLodgingStatus = (receiptId: string): LodgingStatus => {
    const confirmedMatch = state.matches.some(
      match => match.receipt_ref === receiptId && match.reviewer_decision === 'confirmed'
    );
    if (confirmedMatch) return 'acknowledged';
    return state.receipts.find(receipt => receipt.id === receiptId)?.lodging_status || 'pending';
  };

  const getBillOutcomes = (billId: string): { status: SubmissionStage; count: number }[] => {
    const billReceipts = state.receipts.filter(r => r.legislative_item_id === billId);
    return STAGE_ORDER.map(status => ({
      status,
      count: billReceipts.filter(r => getSubmissionStatus(r.id) === status).length,
    }));
  };

  return (
    <AppContext.Provider value={{ state, dispatch, getSubmissionStatus, getSubmissionReviewDecision, getSubmissionLodgingStatus, getBillOutcomes }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
