import React, { createContext, useContext, useEffect, useReducer, ReactNode } from 'react';
import {
  User, LegislativeItem, ParticipationReceipt, CommitteeReport,
  ReportEntry, SubmissionMatch, NoticeRecord, RepresentativeProfile,
  ModerationAction, AuditLogEntry, UserRole, SubmissionStatus,
  RepresentativeStatus, ReviewerDecision, LodgingStatus
} from '../types';
import {
  seedUsers, seedBills, seedReceipts, seedReports, seedReportEntries,
  seedMatches, seedNotices, seedProfiles, seedModerationActions, seedAuditLog
} from '../data/seed';
import { api } from '../api/endpoints';

interface AppState {
  users: User[];
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
  | { type: 'ADD_AUDIT_LOG'; payload: AuditLogEntry }
  | { type: 'ADD_REPORT'; payload: CommitteeReport }
  | { type: 'ADD_REPORT_ENTRIES'; payload: ReportEntry[] }
  | { type: 'ADD_MATCH'; payload: SubmissionMatch }
  | { type: 'UPDATE_MATCH_DECISION'; payload: { matchId: string; decision: ReviewerDecision; reviewerId: string } }
  | { type: 'ADD_NOTICE'; payload: NoticeRecord }
  | { type: 'UPDATE_REPORT_STATUS'; payload: { reportId: string; status: CommitteeReport['extraction_status'] } }
  | { type: 'CLAIM_PROFILE'; payload: { profileId: string; userId: string } }
  | { type: 'VERIFY_PROFILE'; payload: { profileId: string; verifierId: string; status: RepresentativeStatus } }
  | { type: 'UPDATE_RECEIPT_LODGING'; payload: { receiptId: string; status: LodgingStatus } }
  | { type: 'ADD_MODERATION'; payload: ModerationAction }
  | { type: 'UPDATE_MODERATION'; payload: { id: string; decision: ModerationAction['decision']; moderatorId: string } }
  | { type: 'ADD_USER'; payload: User }
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'UPDATE_REPORT_ENTRY'; payload: { entryId: string; treatment: SubmissionStatus; stated_reason?: string } };

const initialState: AppState = {
  users: seedUsers,
  bills: seedBills,
  receipts: seedReceipts,
  reports: seedReports,
  reportEntries: seedReportEntries,
  matches: seedMatches,
  notices: seedNotices,
  profiles: seedProfiles,
  moderationActions: seedModerationActions,
  auditLog: seedAuditLog,
  currentUser: null,
  isOnline: true,
  isLoading: true,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, isLoading: false, apiError: undefined };
    case 'SET_API_ERROR':
      return {
        ...state,
        isLoading: false,
        apiError: action.payload,
      };
    case 'ADD_RECEIPT':
      return { ...state, receipts: [...state.receipts, action.payload] };
    case 'ADD_AUDIT_LOG':
      return { ...state, auditLog: [...state.auditLog, action.payload] };
    case 'ADD_REPORT':
      return { ...state, reports: [...state.reports, action.payload] };
    case 'ADD_REPORT_ENTRIES':
      return { ...state, reportEntries: [...state.reportEntries, ...action.payload] };
    case 'ADD_MATCH':
      return { ...state, matches: [...state.matches, action.payload] };
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
          m.id === action.payload.id ? { ...m, decision: action.payload.decision, moderator_id: action.payload.moderatorId } : m
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
  getSubmissionStatus: (receiptId: string) => SubmissionStatus;
  getBillOutcomes: (billId: string) => { status: SubmissionStatus; count: number }[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    api.bootstrap().then(data => {
      if (cancelled) return;
      dispatch({ type: 'HYDRATE', payload: {
        // Keep the bundled demo bills available when the API is reachable but
        // has not been seeded yet. This is especially important for clerk
        // report ingestion, which must always have a bill to attach to.
        bills: data.bills.length > 0 ? data.bills : seedBills,
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

  const getSubmissionStatus = (receiptId: string): SubmissionStatus => {
    const confirmedMatch = state.matches.find(
      m => m.receipt_ref === receiptId && m.reviewer_decision === 'confirmed'
    );
    if (!confirmedMatch) return 'awaiting committee report';
    const entry = state.reportEntries.find(e => e.id === confirmedMatch.report_entry_ref);
    if (!entry) return 'awaiting committee report';
    return entry.treatment;
  };

  const getBillOutcomes = (billId: string): { status: SubmissionStatus; count: number }[] => {
    const billReceipts = state.receipts.filter(r => r.legislative_item_id === billId);
    const statuses: SubmissionStatus[] = [
      'awaiting committee report', 'adopted', 'amended', 'rejected with reasons', 'not addressed'
    ];
    
    return statuses.map(status => ({
      status,
      count: billReceipts.filter(r => getSubmissionStatus(r.id) === status).length,
    }));
  };

  return (
    <AppContext.Provider value={{ state, dispatch, getSubmissionStatus, getBillOutcomes }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
