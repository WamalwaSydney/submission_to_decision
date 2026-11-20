import React, { lazy, Suspense, useCallback, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout';
import { AuthShell } from './components/AuthShell';
import { HomePage } from './pages/HomePage';

// Every page but the home page is loaded when first opened, so the first visit downloads only what it shows.
function lazyPage<K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, name: K) {
  return lazy(() => load().then(module => ({ default: module[name] })));
}
const BillsListPage = lazyPage(() => import('./pages/BillsPages'), 'BillsListPage');
const BillPage = lazyPage(() => import('./pages/BillsPages'), 'BillPage');
const ActPage = lazyPage(() => import('./pages/ActPage'), 'ActPage');
const ReceiptLookupPage = lazyPage(() => import('./pages/ReceiptPages'), 'ReceiptLookupPage');
const ReceiptVerifyPage = lazyPage(() => import('./pages/ReceiptPages'), 'ReceiptVerifyPage');
const ReportRecordPage = lazyPage(() => import('./pages/ReceiptPages'), 'ReportRecordPage');
const SubmitViewPage = lazyPage(() => import('./pages/SubmitViewPage'), 'SubmitViewPage');
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const ResetPasswordPage = lazyPage(() => import('./pages/ResetPasswordPage'), 'ResetPasswordPage');
const SignupPage = lazyPage(() => import('./pages/SignupPage'), 'SignupPage');
const ReviewerQueuePage = lazyPage(() => import('./pages/ModeratorPages'), 'ReviewerQueuePage');
const ReportedContentPage = lazyPage(() => import('./pages/ModeratorPages'), 'ReportedContentPage');
const CommitteeOfficerIngestionPage = lazyPage(() => import('./pages/ClerkPages'), 'CommitteeOfficerIngestionPage');
const CommitteeOfficerNoticesPage = lazyPage(() => import('./pages/ClerkPages'), 'CommitteeOfficerNoticesPage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const ResearchExportPage = lazyPage(() => import('./pages/OtherPages'), 'ResearchExportPage');
const CommunityRulesPage = lazyPage(() => import('./pages/OtherPages'), 'CommunityRulesPage');
const PrivacyPolicyPage = lazyPage(() => import('./pages/OtherPages'), 'PrivacyPolicyPage');
const MyReceiptsPage = lazyPage(() => import('./pages/OtherPages'), 'MyReceiptsPage');
const CommitteeDashboardPage = lazyPage(() => import('./pages/CommitteePages'), 'CommitteeDashboardPage');
const BillFlowPage = lazyPage(() => import('./pages/CommitteePages'), 'BillFlowPage');
const MessagesPage = lazyPage(() => import('./pages/MessagesPage'), 'MessagesPage');

function PageLoading() {
  return <p role="status" className="p-6 text-sm font-semibold text-[#526060]">Loading…</p>;
}

import { api } from './api/endpoints';
import { ApiError } from './api/client';
import { getUnsyncedDrafts, markDraftSynced } from './utils/offline';

function OnlineStatusListener() {
  const { dispatch, state } = useApp();

  const syncDrafts = useCallback(async () => {
    if (!state.currentUser || state.currentUser.role !== 'citizen' || !navigator.onLine) return;
    const drafts = await getUnsyncedDrafts();
    for (const draft of drafts) {
      try {
        const result = await api.createReceipt({
          legislative_item_id: draft.legislative_item_id,
          clause_ref: draft.clause_ref,
          submission_text: draft.submission_text,
          show_name_publicly: false,
        });
        await markDraftSynced(draft.id);
        dispatch({ type: 'ADD_RECEIPT', payload: {
          id: String(result.receipt_id), public_id: String(result.public_id),
          author_id: state.currentUser.id, legislative_item_id: draft.legislative_item_id,
          clause_ref: draft.clause_ref, submission_text: draft.submission_text,
          lodging_status: 'pending', timestamp: result.timestamp, hash: result.hash,
          previous_hash: result.previous_hash,
        }});
      } catch (error) {
        // 409/422: the bill closed, or the citizen already has a submission on it.
        // Retrying can never succeed, so drop the draft instead of blocking the queue.
        if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
          await markDraftSynced(draft.id);
          continue;
        }
        // Otherwise keep the draft queued. A later online event or app start retries it.
        break;
      }
    }
  }, [dispatch, state.currentUser]);

  useEffect(() => {
    const handleOnline = () => {
      dispatch({ type: 'SET_ONLINE', payload: true });
      void syncDrafts();
    };
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });
    if (navigator.onLine) void syncDrafts();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [dispatch, syncDrafts]);

  return null;
}

function CitizenSubmissionRoute() {
  const { state } = useApp();
  const location = useLocation();
  // Remember the bill they were submitting on, so sign-in brings them back here.
  if (!state.currentUser) return <Navigate to="/login" replace state={{ from: location }} />;
  if (state.currentUser.role !== 'citizen') return <Navigate to="/" replace />;
  return <SubmitViewPage />;
}

function MenuLayout() {
  return <Layout><Suspense fallback={<PageLoading />}><Outlet /></Suspense></Layout>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Account pages have no navigation menu; it appears once signed in. */}
      <Route element={<AuthShell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signin" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route element={<MenuLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/bills" element={<BillsListPage />} />
        <Route path="/bills/:id" element={<BillPage />} />
        <Route path="/bills/:id/act" element={<ActPage />} />
        <Route path="/bill-flow/:id" element={<BillFlowPage />} />
        <Route path="/receipt-lookup" element={<ReceiptLookupPage />} />
        <Route path="/receipt-verify" element={<ReceiptVerifyPage />} />
        <Route path="/records/:id" element={<ReportRecordPage />} />
        <Route path="/submit" element={<CitizenSubmissionRoute />} />
        <Route path="/account-security" element={<Navigate to="/" replace />} />
        {/* Calls for views now show as each bill's status on the Bills page. */}
        <Route path="/notices" element={<Navigate to="/bills?show=calls" replace />} />
        <Route path="/outcomes" element={<Navigate to="/bills?show=submissions" replace />} />
        <Route path="/my-receipts" element={<MyReceiptsPage />} />
        <Route path="/reviewer/queue" element={<ReviewerQueuePage />} />
        <Route path="/reviewer/reports" element={<ReportedContentPage />} />
        <Route path="/committee/ingestion" element={<CommitteeOfficerIngestionPage />} />
        <Route path="/committee/notices" element={<CommitteeOfficerNoticesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/research/export" element={<ResearchExportPage />} />
        <Route path="/community-rules" element={<CommunityRulesPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/committee" element={<CommitteeDashboardPage />} />
        <Route path="/messages" element={<MessagesPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AppProvider>
      <HashRouter>
        <OnlineStatusListener />
        <Suspense fallback={<PageLoading />}>
          <AppRoutes />
        </Suspense>
      </HashRouter>
    </AppProvider>
  );
}

export default App;
