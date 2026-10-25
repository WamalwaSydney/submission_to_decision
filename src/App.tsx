import React, { useCallback, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { BillsListPage, BillPage } from './pages/BillsPages';
import { ReceiptLookupPage, ReceiptVerifyPage } from './pages/ReceiptPages';
import { SubmitViewPage } from './pages/SubmitViewPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { NoticesPage } from './pages/NoticesPage';
import { SignupPage } from './pages/SignupPage';
import { ReviewerQueuePage, ReportedContentPage } from './pages/ModeratorPages';
import { CommitteeOfficerIngestionPage, CommitteeOfficerNoticesPage } from './pages/ClerkPages';
import { AdminPage } from './pages/AdminPage';
import { ResearchExportPage, CommunityRulesPage, MyReceiptsPage } from './pages/OtherPages';
import { CommitteeDashboardPage, BillFlowPage } from './pages/CommitteePages';
import { MessagesPage } from './pages/MessagesPage';
import { api } from './api/endpoints';
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
      } catch {
        // Keep the draft queued. A later online event or app start retries it.
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
  if (!state.currentUser) return <Navigate to="/login" replace />;
  if (state.currentUser.role !== 'citizen') return <Navigate to="/" replace />;
  return <SubmitViewPage />;
}

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/bills" element={<BillsListPage />} />
        <Route path="/bills/:id" element={<BillPage />} />
        <Route path="/bill-flow/:id" element={<BillFlowPage />} />
        <Route path="/receipt-lookup" element={<ReceiptLookupPage />} />
        <Route path="/receipt-verify" element={<ReceiptVerifyPage />} />
        <Route path="/submit" element={<CitizenSubmissionRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signin" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account-security" element={<Navigate to="/" replace />} />
        <Route path="/notices" element={<NoticesPage />} />
        <Route path="/my-receipts" element={<MyReceiptsPage />} />
        
        <Route path="/reviewer/queue" element={<ReviewerQueuePage />} />
        <Route path="/reviewer/reports" element={<ReportedContentPage />} />
        <Route path="/committee/ingestion" element={<CommitteeOfficerIngestionPage />} />
        <Route path="/committee/notices" element={<CommitteeOfficerNoticesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/research/export" element={<ResearchExportPage />} />
        <Route path="/community-rules" element={<CommunityRulesPage />} />
        <Route path="/committee" element={<CommitteeDashboardPage />} />
        <Route path="/messages" element={<MessagesPage />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <AppProvider>
      <HashRouter>
        <OnlineStatusListener />
        <AppRoutes />
      </HashRouter>
    </AppProvider>
  );
}

export default App;
