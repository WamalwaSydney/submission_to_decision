import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { RepresentativeStatus } from '../types';
import { Shield, Users, Download, Settings, AlertTriangle, Info, CheckCircle2, XCircle, Upload, FileText, Gauge } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, DisclaimerBox, InfoBox, Card } from '../components/UI';

export function AdminPage() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<'profiles' | 'roles' | 'export' | 'settings'>('profiles');

  const handleVerifyProfile = (profileId: string, status: RepresentativeStatus) => {
    if (!state.currentUser) return;
    dispatch({
      type: 'VERIFY_PROFILE',
      payload: { profileId, verifierId: state.currentUser.id, status }
    });
  };

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

  const unclaimedProfiles = state.profiles.filter(p => p.verification_status === 'unclaimed');
  const pendingClaims = unclaimedProfiles.filter(p => p.user_id);

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
          Manage profiles, roles, settings, and data exports.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-surface-100/70 border border-surface-200 mb-6">
        {[
          { key: 'profiles', label: 'Profile Verification', icon: Shield },
          { key: 'roles', label: 'Role Management', icon: Users },
          { key: 'export', label: 'Data Export', icon: Download },
          { key: 'settings', label: 'Settings', icon: Settings },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab.key
                ? 'bg-white shadow-soft text-primary-700 border border-surface-200'
                : 'text-surface-600 hover:bg-white/60'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profiles' && (
        <div className="space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white shadow-lg shadow-primary-500/25">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600">Approval Queue</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">Pending Profile Claims</h2>
              </div>
            </div>

            {pendingClaims.length === 0 ? (
              <Card className="!p-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-200/50 mb-4">
                  <CheckCircle2 className="h-7 w-7 text-surface-400" />
                </div>
                <h3 className="text-xl font-bold text-surface-900 mb-1">No pending profile claims</h3>
                <p className="text-surface-600">All claimed profiles have been reviewed. Check back later.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {pendingClaims.map((profile, idx) => (
                  <motion.div
                    key={profile.id}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: idx * 0.04 }}
                  >
                    <Card className="!p-6 relative overflow-hidden">
                      <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-warm-100/60 blur-3xl pointer-events-none" />
                      <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="yellow" showIcon className="!text-[10px] !py-1">Awaiting Review</Badge>
                            <Badge variant="gray" className="!text-[10px] !py-1 ml-1">{profile.profile_label.toUpperCase()}</Badge>
                          </div>
                          <h3 className="font-black text-surface-900 text-lg mb-0.5">{profile.office}</h3>
                          <p className="text-sm text-surface-600 font-medium mb-1">
                            <span className="text-surface-400">Jurisdiction:</span> {profile.jurisdiction}
                          </p>
                          <p className="text-sm text-surface-600 font-medium mb-2">
                            <span className="text-surface-400">Institution:</span> {profile.institution}
                          </p>
                          <p className="text-xs text-surface-500 bg-surface-50 border border-surface-100 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5">
                            <Users className="h-3 w-3" /> Claimed by user: <span className="font-bold">{profile.user_id}</span>
                          </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 md:shrink-0">
                          <button onClick={() => handleVerifyProfile(profile.id, 'verified and active')} className="btn-primary text-sm inline-flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4" /> Verify Active
                          </button>
                          <button onClick={() => handleVerifyProfile(profile.id, 'verified but inactive')} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                            <XCircle className="h-4 w-4" /> Verify Inactive
                          </button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="inline-flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white shadow-lg shadow-accent-500/25">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-accent-600">Full Registry</div>
                <h2 className="text-2xl font-black text-surface-900 tracking-tight">All Profiles</h2>
              </div>
            </div>

            <Card className="!p-7 md:!p-8 relative overflow-hidden">
              <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-accent-100/50 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Office</th>
                        <th>Jurisdiction</th>
                        <th>Institution</th>
                        <th>Status</th>
                        <th>Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.profiles.map((p, idx) => (
                        <motion.tr
                          key={p.id}
                          initial={{ opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.35, delay: idx * 0.02 }}
                        >
                          <td className="font-semibold">{p.office}</td>
                          <td>{p.jurisdiction}</td>
                          <td className="text-xs font-medium">{p.institution}</td>
                          <td>
                            <Badge variant={p.verification_status === 'unclaimed' ? 'gray' : 'green'} showIcon className="!text-[10px]">
                              {p.verification_status}
                            </Badge>
                          </td>
                          <td><Badge variant="gray" className="!text-[10px]">{p.profile_label}</Badge></td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

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

            <Card className="!p-7 md:!p-8 relative overflow-hidden">
              <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-purple-100/50 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.users.map((u, idx) => (
                        <motion.tr
                          key={u.id}
                          initial={{ opacity: 0, y: 12 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.35, delay: idx * 0.02 }}
                        >
                          <td className="font-semibold">{u.name}</td>
                          <td className="text-xs font-medium">{u.email}</td>
                          <td><Badge variant="blue" showIcon className="!text-[10px] capitalize">{u.role}</Badge></td>
                          <td><Badge variant="green" showIcon className="!text-[10px]">{u.status}</Badge></td>
                          <td className="text-xs">{new Date(u.created_date).toLocaleDateString()}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
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

          <div className="space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0 }}
            >
              <Card className="!p-7 relative overflow-hidden border-0">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-white" />
                <div className="absolute -top-24 -right-16 w-56 h-56 rounded-full bg-primary-200/40 blur-3xl pointer-events-none" />
                <div className="relative flex gap-5">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white shadow-lg shadow-primary-500/30">
                    <Upload className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-black text-surface-900 tracking-tight mb-1">Ingestion Settings</h3>
                    <div className="space-y-2 mt-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-primary-100/60">
                        <span className="text-sm font-semibold text-surface-700">OCR fallback threshold</span>
                        <Badge variant="blue" className="!text-[11px]">text coverage below 10%</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-primary-100/60">
                        <span className="text-sm font-semibold text-surface-700">Max file size</span>
                        <Badge variant="blue" className="!text-[11px]">50MB</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-primary-100/60">
                        <span className="text-sm font-semibold text-surface-700">Supported formats</span>
                        <Badge variant="blue" className="!text-[11px]">PDF (native + scanned)</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.05 }}
            >
              <Card className="!p-7 relative overflow-hidden border-0">
                <div className="absolute inset-0 bg-gradient-to-br from-warm-50 via-white to-white" />
                <div className="absolute -bottom-24 -left-16 w-56 h-56 rounded-full bg-warm-200/40 blur-3xl pointer-events-none" />
                <div className="relative flex gap-5">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-warm-500 to-warm-700 flex items-center justify-center text-white shadow-lg shadow-warm-500/30">
                    <Shield className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-black text-surface-900 tracking-tight mb-1">Moderation Settings</h3>
                    <div className="space-y-2 mt-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-warm-100/60">
                        <span className="text-sm font-semibold text-surface-700">Auto-quarantine</span>
                        <Badge variant="warm" className="!text-[11px]">disabled · human review only</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-warm-100/60">
                        <span className="text-sm font-semibold text-surface-700">Appeal window</span>
                        <Badge variant="warm" className="!text-[11px]">14 days</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-warm-100/60">
                        <span className="text-sm font-semibold text-surface-700">Rate limit</span>
                        <Badge variant="warm" className="!text-[11px]">5 submissions / user / hour</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: 0.1 }}
            >
              <Card className="!p-7 relative overflow-hidden border-0">
                <div className="absolute inset-0 bg-gradient-to-br from-accent-50 via-white to-white" />
                <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-accent-200/40 blur-3xl pointer-events-none" />
                <div className="relative flex gap-5">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white shadow-lg shadow-accent-500/30">
                    <Gauge className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-black text-surface-900 tracking-tight mb-1">Matching Engine</h3>
                    <div className="space-y-2 mt-3">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-accent-100/60">
                        <span className="text-sm font-semibold text-surface-700">Primary method</span>
                        <Badge variant="accent" className="!text-[11px]">Clause-reference matching (rule-based)</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-accent-100/60">
                        <span className="text-sm font-semibold text-surface-700">Fallback</span>
                        <Badge variant="accent" className="!text-[11px]">Text similarity (rapidfuzz)</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-accent-100/60">
                        <span className="text-sm font-semibold text-surface-700">Min confidence for auto-queue</span>
                        <Badge variant="accent" className="!text-[11px]">0.3</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
}
