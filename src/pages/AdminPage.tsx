import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { Shield, Users, Download, Settings, AlertTriangle, Info, Upload, Gauge, ChevronLeft, ChevronRight, Save, UserRound, KeyRound, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, DisclaimerBox, InfoBox, Card } from '../components/UI';

export function AdminPage() {
  const { state } = useApp();
  const [activeTab, setActiveTab] = useState<'roles' | 'committees' | 'export' | 'settings'>('roles');
  const [adminUsers, setAdminUsers] = useState(state.users);
  const [userPage, setUserPage] = useState(1);
  const [userMessage, setUserMessage] = useState('');
  const [committeeDirectory, setCommitteeDirectory] = useState(state.committees);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState<{ userId: string; userName: string; link: string; expiresAt: string } | null>(null);
  const [issuingReset, setIssuingReset] = useState<string | null>(null);
  const [userEdits, setUserEdits] = useState<Record<string, { role: any; status: any; committee_id: string }>>({});
  const [committeeForm, setCommitteeForm] = useState({ name: '', institution: 'National Assembly', description: '', contact_email: '', account_name: '', account_email: '', account_password: '' });
  const [committeeMessage, setCommitteeMessage] = useState('');
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_settings') || 'null') || { ocrThreshold: 10, maxFileSizeMb: 50, supportedFormats: 'PDF (native + scanned)', autoQuarantine: false, appealWindowDays: 14, rateLimit: 5, matchingMethod: 'Clause-reference matching (rule-based)', fallbackMethod: 'Text similarity (rapidfuzz)', minConfidence: 0.3 }; } catch { return { ocrThreshold: 10, maxFileSizeMb: 50, supportedFormats: 'PDF (native + scanned)', autoQuarantine: false, appealWindowDays: 14, rateLimit: 5, matchingMethod: 'Clause-reference matching (rule-based)', fallbackMethod: 'Text similarity (rapidfuzz)', minConfidence: 0.3 }; }
  });
  const [settingsMessage, setSettingsMessage] = useState('');

  useEffect(() => {
    if (activeTab !== 'roles' || state.currentUser?.role !== 'administrator') return;
    let cancelled = false;
    api.users()
      .then(({ users }) => {
        if (!cancelled) {
          setAdminUsers(users);
          setUserPage(1);
        }
      })
      .catch(() => {
        // The live registry remains empty when the protected request fails.
      });
    return () => { cancelled = true; };
  }, [activeTab, state.currentUser?.role]);

  const usersPerPage = 10;
  const totalUserPages = Math.max(1, Math.ceil(adminUsers.length / usersPerPage));
  const visibleUsers = adminUsers.slice((userPage - 1) * usersPerPage, userPage * usersPerPage);

  const handleUserEdit = (user: any, field: string, value: string) => {
    setUserEdits(previous => ({
      ...previous,
      [user.id]: { ...{ role: user.role, status: user.status, committee_id: user.committee_id || '' }, ...(previous[user.id] || {}), [field]: value },
    }));
  };

  const handleSaveUser = async (user: any) => {
    const edit = userEdits[user.id] || { role: user.role, status: user.status, committee_id: user.committee_id || '' };
    setSavingUserId(user.id); setUserMessage('');
    try {
      const response = await api.updateUser(user.id, { role: edit.role, status: edit.status, committee_id: edit.committee_id || undefined });
      setAdminUsers(users => users.map(item => item.id === user.id ? response.user : item));
      setUserEdits(previous => { const next = { ...previous }; delete next[user.id]; return next; });
      setUserMessage(`${user.name}'s account was updated.`);
    } catch (error) { setUserMessage(error instanceof Error ? error.message : 'Unable to update this account.'); }
    finally { setSavingUserId(null); }
  };

  const handleIssuePasswordReset = async (user: any) => {
    const confirmed = window.confirm(`Only continue after verifying ${user.name}'s identity through a trusted, independent channel. Generate a single-use password recovery code?`);
    if (!confirmed) return;
    setIssuingReset(user.id); setUserMessage(''); setResetCode(null);
    try {
      const result = await api.issuePasswordReset(user.id);
      const link = `${window.location.origin}${window.location.pathname}#/reset-password?token=${encodeURIComponent(result.reset_code)}`;
      setResetCode({ userId: user.id, userName: user.name, link, expiresAt: result.expires_at });
      setUserMessage(`A one-time recovery link for ${user.name} was generated. Copy it now and deliver it only through the verified channel.`);
    } catch (error) { setUserMessage(error instanceof Error ? error.message : 'Unable to issue a recovery code.'); }
    finally { setIssuingReset(null); }
  };

  const handleCreateCommittee = async (event: React.FormEvent) => {
    event.preventDefault(); setCommitteeMessage('');
    try {
      const response = await api.createCommittee(committeeForm);
      setCommitteeDirectory(previous => [...previous, response.committee]);
      setCommitteeForm({ name: '', institution: 'National Assembly', description: '', contact_email: '', account_name: '', account_email: '', account_password: '' });
      setCommitteeMessage('Committee and officer account created.');
    } catch (error) { setCommitteeMessage(error instanceof Error ? error.message : 'Unable to create committee.'); }
  };

  const saveSettings = () => { localStorage.setItem('admin_settings', JSON.stringify(settings)); setSettingsMessage('Settings saved for this deployment.'); };

  const handleExportAnonymized = () => {
    // Anonymized export: no user identifiers
    const data = {
      receipts: state.receipts.map(r => ({
        public_id: r.public_id,
        legislative_item_id: r.legislative_item_id,
        clause_ref: r.clause_ref,
        submission_text: r.submission_text,
        timestamp: r.timestamp,
        lodging_status: r.lodging_status,
        // author_id STRIPPED
      })),
      report_entries: state.reportEntries.map(e => ({
        id: e.id,
        clause_ref: e.clause_ref,
        extracted_summary: e.extracted_summary,
        treatment: e.treatment,
        stated_reason: e.stated_reason,
      })),
      confirmed_matches: state.matches
        .filter(m => m.reviewer_decision === 'confirmed')
        .map(m => ({
          receipt_ref: m.receipt_ref,
          report_entry_ref: m.report_entry_ref,
          match_method: m.match_method,
          confidence_score: m.confidence_score,
          timestamp: m.timestamp,
          // reviewer_id STRIPPED
        })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'anonymized-dataset.json';
    a.click();
    URL.revokeObjectURL(url);
  };



  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Administration</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Platform <span className="gradient-text">Administration</span>
        </h1>
        <p className="text-lg text-surface-600 leading-relaxed max-w-3xl">
          Manage user access, committees, system settings, and data exports.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-surface-100/70 border border-surface-200 mb-6">
        {[
          { key: 'roles', label: 'Role Management', icon: Users },
          { key: 'committees', label: 'Committees', icon: Users },
          { key: 'export', label: 'Data Export', icon: Download },
          { key: 'settings', label: 'Settings', icon: Settings },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === tab.key ? 'bg-white shadow-soft text-primary-700 border border-surface-200' : 'text-surface-600 hover:bg-white/60'}`}>
            <tab.icon className="h-4 w-4" />{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'roles' && (
        <div className="space-y-6">
          <div>
            <div className="inline-flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white shadow-lg shadow-purple-500/25">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-purple-600">Access Control</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">User Accounts</h2>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-2xl border border-purple-100 bg-purple-50/70 p-4"><div className="text-xs font-black uppercase tracking-wider text-purple-600">Total users</div><div className="mt-1 text-2xl font-black text-surface-900">{adminUsers.length}</div></div>
              <div className="rounded-2xl border border-green-100 bg-green-50/70 p-4"><div className="text-xs font-black uppercase tracking-wider text-green-700">Active</div><div className="mt-1 text-2xl font-black text-surface-900">{adminUsers.filter(user => user.status === 'active').length}</div></div>
              <div className="rounded-2xl border border-warm-100 bg-warm-50/70 p-4"><div className="text-xs font-black uppercase tracking-wider text-warm-700">Pending</div><div className="mt-1 text-2xl font-black text-surface-900">{adminUsers.filter(user => user.status === 'pending_approval').length}</div></div>
              <div className="rounded-2xl border border-surface-200 bg-white p-4"><div className="text-xs font-black uppercase tracking-wider text-surface-500">Unsaved</div><div className="mt-1 text-2xl font-black text-surface-900">{Object.keys(userEdits).length}</div></div>
            </div>
            <Card className="!p-0 relative overflow-hidden border border-surface-200 shadow-soft">
              <div className="flex flex-col gap-2 border-b border-surface-200 bg-gradient-to-r from-purple-50 via-white to-white px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                <div><h3 className="text-base font-black text-surface-900">Account access directory</h3><p className="text-xs text-surface-500 mt-1">Edit access in place, then save each account independently.</p></div>
                <div className="inline-flex items-center gap-2 text-xs font-bold text-surface-500"><span className="h-2 w-2 rounded-full bg-green-500" /> Changes are administrator-only</div>
              </div>
              <div className="relative">
                <div className="table-container">
                  <table className="data-table role-management-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Committee</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleUsers.map((u, idx) => (
                        <motion.tr
                          key={u.id}
                          initial={{ opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.35, delay: idx * 0.02 }}
                        >
                          <td className="role-management-user"><div className="flex items-center gap-3"><span className="role-management-avatar"><UserRound className="h-4 w-4" /></span><span><strong>{u.name}</strong><small>{u.email}</small></span></div></td>
                          <td><select aria-label={`Set ${u.name} role`} className="input-field !py-2 !text-xs role-management-select" value={(userEdits[u.id]?.role ?? u.role)} onChange={event => handleUserEdit(u, 'role', event.target.value)}><option value="citizen">Citizen</option><option value="committee_officer">Clerk’s Office / Committee Secretariat</option><option value="reviewer">Moderator</option><option value="administrator">Administrator</option></select></td>
                          <td>{(userEdits[u.id]?.role ?? u.role) === 'committee_officer' ? (
                            <select aria-label={`Assign ${u.name} to committee`} className="input-field !py-2 !text-xs role-management-select min-w-48" value={userEdits[u.id]?.committee_id ?? u.committee_id ?? ''} onChange={event => handleUserEdit(u, 'committee_id', event.target.value)}><option value="">Select committee</option>{committeeDirectory.map(committee => <option key={committee.id} value={committee.id}>{committee.name}</option>)}</select>
                          ) : <span className="text-xs font-semibold text-surface-500">{committeeDirectory.find(committee => committee.id === u.committee_id)?.name || 'No committee'}</span>}</td>
                          <td><select aria-label={`Set ${u.name} status`} className="input-field !py-2 !text-xs role-management-select" value={(userEdits[u.id]?.status ?? u.status)} onChange={event => handleUserEdit(u, 'status', event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="pending_approval">Pending approval</option></select></td>
                          <td className="text-xs font-semibold text-surface-500 whitespace-nowrap">{new Date(u.created_date).toLocaleDateString()}</td>
                          <td><div className="flex flex-col gap-2 items-start"><button type="button" onClick={() => handleSaveUser(u)} disabled={savingUserId !== null || !userEdits[u.id]} className="role-management-save btn-primary !px-3 !py-2 text-xs disabled:opacity-50"><Save className="h-3.5 w-3.5" />{savingUserId === u.id ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => handleIssuePasswordReset(u)} disabled={issuingReset !== null || u.status !== 'active'} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-50" title="Verify identity first; code is shown once"><KeyRound className="h-3.5 w-3.5" />{issuingReset === u.id ? 'Creating…' : 'Recovery link'}</button></div></td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {userMessage && <p role="status" className="mt-4 text-sm font-semibold text-primary-700">{userMessage}</p>}
                {resetCode && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert"><p className="font-bold text-amber-950">One-time password recovery link for {resetCode.userName}</p><p className="mt-1 text-xs text-amber-900">Expires {new Date(resetCode.expiresAt).toLocaleString()}. It is shown only once. Deliver it only after independent identity verification; do not send it to the account email unless that channel was verified separately.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label="One-time recovery link" readOnly value={resetCode.link} className="input-field min-w-0 flex-1 text-xs" /><button type="button" onClick={() => void navigator.clipboard.writeText(resetCode.link)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white"><Copy className="h-3.5 w-3.5" />Copy link</button></div></div>}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-5 pt-4 border-t border-surface-200">
                  <p className="text-xs font-semibold text-surface-500">
                    Showing {adminUsers.length === 0 ? 0 : (userPage - 1) * usersPerPage + 1}–{Math.min(userPage * usersPerPage, adminUsers.length)} of {adminUsers.length} users
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setUserPage(page => Math.max(1, page - 1))}
                      disabled={userPage === 1}
                      className="btn-secondary !px-3 !py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Previous users page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-bold text-surface-700 min-w-24 text-center">Page {Math.min(userPage, totalUserPages)} of {totalUserPages}</span>
                    <button
                      type="button"
                      onClick={() => setUserPage(page => Math.min(totalUserPages, page + 1))}
                      disabled={userPage >= totalUserPages}
                      className="btn-secondary !px-3 !py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Next users page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <DisclaimerBox className="!p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm">
                  Role changes are logged in the audit trail. Least-privilege access is enforced.
                </p>
              </div>
            </div>
          </DisclaimerBox>
        </div>
      )}

      {activeTab === 'committees' && (
        <div className="space-y-6">
          <Card className="!p-6"><h2 className="text-2xl font-black text-surface-900 mb-2">Create Clerk’s Office access</h2><p className="text-sm text-surface-600 mb-5">Administrators can create a committee record and its first Clerk’s Office account here.</p>
            <form onSubmit={handleCreateCommittee} className="grid gap-3 md:grid-cols-2">
              <input className="input-field" placeholder="Committee name" value={committeeForm.name} onChange={e => setCommitteeForm({ ...committeeForm, name: e.target.value })} required />
              <select className="input-field" value={committeeForm.institution} onChange={e => setCommitteeForm({ ...committeeForm, institution: e.target.value })}><option>National Assembly</option><option>Nairobi County Assembly</option><option>Trans Nzoia County Assembly</option></select>
              <input className="input-field" placeholder="Description" value={committeeForm.description} onChange={e => setCommitteeForm({ ...committeeForm, description: e.target.value })} />
              <input className="input-field" type="email" placeholder="Committee contact email" value={committeeForm.contact_email} onChange={e => setCommitteeForm({ ...committeeForm, contact_email: e.target.value })} />
              <input className="input-field" placeholder="Officer account name" value={committeeForm.account_name} onChange={e => setCommitteeForm({ ...committeeForm, account_name: e.target.value })} required />
              <input className="input-field" type="email" placeholder="Officer login email" value={committeeForm.account_email} onChange={e => setCommitteeForm({ ...committeeForm, account_email: e.target.value })} required />
              <input className="input-field" type="password" minLength={8} placeholder="Officer password (8+ characters)" value={committeeForm.account_password} onChange={e => setCommitteeForm({ ...committeeForm, account_password: e.target.value })} required />
              <button className="btn-primary" type="submit">Create committee and account</button>
            </form>{committeeMessage && <p role="status" className="mt-4 text-sm font-semibold text-primary-700">{committeeMessage}</p>}
          </Card>
          <Card className="!p-6"><h2 className="text-2xl font-black text-surface-900 mb-2">Committee directory</h2><div className="grid gap-3 md:grid-cols-2">{committeeDirectory.map(committee => <div key={committee.id} className="rounded-xl border border-surface-200 bg-white p-4"><div className="font-bold text-surface-900">{committee.name}</div><div className="mt-1 text-xs font-semibold text-surface-500">{committee.institution}</div>{committee.contact_email && <div className="mt-2 text-xs text-surface-600">{committee.contact_email}</div>}</div>)}</div></Card>
        </div>
      )}
      {activeTab === 'export' && (
        <div className="space-y-6">
          <Card className="!p-7 md:!p-8 relative overflow-hidden">
            <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-primary-100/60 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
            <div className="relative flex flex-col md:flex-row md:items-start gap-6">
              <div className="shrink-0">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 flex items-center justify-center text-white shadow-xl shadow-primary-500/30">
                  <Download className="h-7 w-7" />
                </div>
              </div>
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 mb-2">
                  <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600">Privacy-First Export</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-surface-900 tracking-tight mb-3">Anonymized Dataset Export</h2>
                <p className="text-[15px] text-surface-600 leading-relaxed mb-6 max-w-2xl">
                  Export an anonymized dataset containing receipts, extracted report entries, and confirmed matches.
                  All user identifiers (author_id, reviewer_id, auth data) are stripped.
                </p>
                <button onClick={handleExportAnonymized} className="btn-primary inline-flex items-center gap-2 shadow-lg shadow-primary-500/20">
                  <Download className="h-4 w-4" /> Export JSON (Anonymized)
                </button>
              </div>
            </div>
          </Card>

          <InfoBox className="!p-5">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-3">
                <div>
                  <h3 className="font-bold text-primary-900 mb-1">What's Included</h3>
                  <p className="text-sm text-primary-800/85 leading-relaxed">
                    Receipt public IDs, submission text, bill references, clause references, timestamps, lodging status,
                    report entry summaries and treatments, confirmed match methods and confidence scores.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold text-primary-900 mb-1">What's Stripped</h3>
                  <p className="text-sm text-primary-800/85 leading-relaxed">
                    Author IDs, reviewer IDs, auth data, any personally identifiable information.
                  </p>
                </div>
              </div>
            </div>
          </InfoBox>
        </div>
      )}

      {activeTab === 'settings' && (
        <div>
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-warm-500 to-warm-700 flex items-center justify-center text-white shadow-lg shadow-warm-500/25">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-warm-600">System Configuration</div>
              <h2 className="text-2xl font-black text-surface-900 tracking-tight">System Settings</h2>
            </div>
          </div>

          <Card className="!p-7"><div className="grid gap-5 md:grid-cols-2">
            <label className="text-sm font-bold">OCR fallback threshold (%)<input className="input-field mt-1" type="number" min="0" max="100" value={settings.ocrThreshold} onChange={e => setSettings({ ...settings, ocrThreshold: Number(e.target.value) })} /></label>
            <label className="text-sm font-bold">Maximum file size (MB)<input className="input-field mt-1" type="number" min="1" value={settings.maxFileSizeMb} onChange={e => setSettings({ ...settings, maxFileSizeMb: Number(e.target.value) })} /></label>
            <label className="text-sm font-bold">Supported formats<input className="input-field mt-1" value={settings.supportedFormats} onChange={e => setSettings({ ...settings, supportedFormats: e.target.value })} /></label>
            <label className="text-sm font-bold">Appeal window (days)<input className="input-field mt-1" type="number" min="0" value={settings.appealWindowDays} onChange={e => setSettings({ ...settings, appealWindowDays: Number(e.target.value) })} /></label>
            <label className="text-sm font-bold">Rate limit (submissions/user/hour)<input className="input-field mt-1" type="number" min="0" value={settings.rateLimit} onChange={e => setSettings({ ...settings, rateLimit: Number(e.target.value) })} /></label>
            <label className="text-sm font-bold">Minimum confidence for auto-queue<input className="input-field mt-1" type="number" min="0" max="1" step="0.05" value={settings.minConfidence} onChange={e => setSettings({ ...settings, minConfidence: Number(e.target.value) })} /></label>
            <label className="text-sm font-bold">Primary matching method<input className="input-field mt-1" value={settings.matchingMethod} onChange={e => setSettings({ ...settings, matchingMethod: e.target.value })} /></label>
            <label className="text-sm font-bold">Fallback matching method<input className="input-field mt-1" value={settings.fallbackMethod} onChange={e => setSettings({ ...settings, fallbackMethod: e.target.value })} /></label>
            <label className="md:col-span-2 inline-flex items-center gap-3 text-sm font-bold"><input type="checkbox" checked={settings.autoQuarantine} onChange={e => setSettings({ ...settings, autoQuarantine: e.target.checked })} /> Enable auto-quarantine</label>
          </div><div className="mt-6 flex items-center gap-3"><button type="button" className="btn-primary" onClick={saveSettings}>Save settings</button>{settingsMessage && <span role="status" className="text-sm font-semibold text-primary-700">{settingsMessage}</span>}</div></Card>
        </div>
      )}
    </div>
  );
}
