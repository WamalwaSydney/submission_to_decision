import React, { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { BillsListPage, BillPage } from './pages/BillsPages';
import { ReceiptLookupPage, ReceiptVerifyPage } from './pages/ReceiptPages';
import { SubmitViewPage } from './pages/SubmitViewPage';
import { LoginPage } from './pages/LoginPage';
import { NoticesPage } from './pages/NoticesPage';
import { ProfilesPage, ProfileDetailPage, ClaimProfilePage } from './pages/ProfilesPages';
import { SignupPage } from './pages/SignupPage';
import { ModeratorQueuePage, ReportedContentPage } from './pages/ModeratorPages';
import { ClerkIngestionPage, ClerkNoticesPage } from './pages/ClerkPages';
import { AdminPage } from './pages/AdminPage';
import { ResearchExportPage, CommunityRulesPage, RepresentativeDashboardPage, MyReceiptsPage } from './pages/OtherPages';

function OnlineStatusListener() {
  const { dispatch } = useApp();

  useEffect(() => {
    const handleOnline = () => dispatch({ type: 'SET_ONLINE', payload: true });
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial state
    dispatch({ type: 'SET_ONLINE', payload: navigator.onLine });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [dispatch]);

  return null;
}

function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/bills" element={<BillsListPage />} />
        <Route path="/bills/:id" element={<BillPage />} />
        <Route path="/receipt-lookup" element={<ReceiptLookupPage />} />
        <Route path="/receipt-verify" element={<ReceiptVerifyPage />} />
        <Route path="/submit" element={<SubmitViewPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signin" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/notices" element={<NoticesPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/profiles/:id" element={<ProfileDetailPage />} />
        <Route path="/my-receipts" element={<MyReceiptsPage />} />
        <Route path="/rep-dashboard" element={<RepresentativeDashboardPage />} />
        <Route path="/claim-profile" element={<ClaimProfilePage />} />
        <Route path="/moderator/queue" element={<ModeratorQueuePage />} />
        <Route path="/moderator/reports" element={<ReportedContentPage />} />
        <Route path="/clerk/ingestion" element={<ClerkIngestionPage />} />
        <Route path="/clerk/notices" element={<ClerkNoticesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/research/export" element={<ResearchExportPage />} />
        <Route path="/community-rules" element={<CommunityRulesPage />} />
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
