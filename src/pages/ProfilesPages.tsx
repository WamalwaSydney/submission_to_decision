import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';
import { RepresentativeStatus, ProfileLabel } from '../types';
import { Users, MapPin, Building2, CheckCircle2, AlertTriangle, Info, Shield, ArrowLeft, UserRoundPlus, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge, DisclaimerBox, InfoBox, Card } from '../components/UI';

export function ProfilesPage() {
  const { state } = useApp();
  const [filter, setFilter] = useState<string>('all');

  const filteredProfiles = filter === 'all'
    ? state.profiles
    : state.profiles.filter(p => p.institution === filter);

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Directory</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">
          Offices & <span className="gradient-text">Representatives</span>
        </h1>
        <p className="text-lg text-surface-600 leading-relaxed max-w-3xl">
          Lightweight profiles for offices in the pilot area. Unclaimed by default, built from public institutional information.
          Profiles can be claimed and verified by administrators.
        </p>
      </div>

      <DisclaimerBox className="!p-5">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm">
              Verification confirms accuracy of office, jurisdiction, committee membership and contact channels ONLY.
              It never grants ability to alter, annotate or respond to a receipt, report entry or confirmed match.
            </p>
          </div>
        </div>
      </DisclaimerBox>

      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-surface-100/70 border border-surface-200">
        {['all', 'National Assembly', 'Nairobi County Assembly', 'Trans Nzoia County Assembly'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              filter === f
                ? 'bg-gradient-to-r from-primary-50 to-accent-50 text-primary-700 border border-primary-200 shadow-sm'
                : 'bg-white text-surface-600 border border-surface-200 hover:border-surface-300 hover:bg-white/80'
            }`}
          >
            {f === 'all' ? 'All Profiles' : f}
          </button>
        ))}
      </div>

      {filteredProfiles.length === 0 ? (
        <Card className="!p-12 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-200/50 mb-5">
            <Users className="h-7 w-7 text-surface-400" />
          </div>
          <h3 className="text-xl font-bold text-surface-900 mb-2">No profiles match this filter</h3>
          <p className="text-surface-600 mb-6">Try selecting a different institution filter.</p>
          <button onClick={() => setFilter('all')} className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> View All Profiles
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProfiles.map((profile, idx) => {
            const verificationVariant =
              profile.verification_status === 'unclaimed' ? 'gray' :
              profile.verification_status === 'verified and active' ? 'green' :
              'yellow';
            const cardTone =
              profile.verification_status === 'verified and active' ? 'primary' :
              profile.verification_status === 'verified but inactive' ? 'warm' : 'gray';

            return (
              <motion.div
                key={profile.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.04 }}
              >
                <Link to={`/profiles/${profile.id}`} className="block group">
                  <Card className="!p-6 h-full relative overflow-hidden group-hover:-translate-y-1 transition-all duration-300">
                    {cardTone !== 'gray' && (
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                        style={{
                          background:
                            cardTone === 'primary' ? 'radial-gradient(ellipse at top right, rgb(58 92 255 / 0.1), transparent 55%)'
                            : 'radial-gradient(ellipse at top right, rgb(237 139 41 / 0.1), transparent 55%)'
                        }}
                      />
                    )}

                    <div className="relative">
                      <div className="flex items-start justify-between mb-4">
                        <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 shadow-primary-500/25 group-hover:scale-105 transition-transform">
                          <Users className="h-6 w-6" />
                        </div>
                        <Badge variant={verificationVariant as any} showIcon className="!text-[10px] !py-1">
                          {profile.verification_status}
                        </Badge>
                      </div>

                      <div className="mb-3">
                        <h3 className="font-black text-surface-900 mb-1 leading-tight group-hover:text-primary-700 transition-colors">
                          {profile.office}
                        </h3>
                        <div className="flex items-center gap-1.5 text-sm text-surface-600 font-medium">
                          <MapPin className="h-3.5 w-3.5 text-primary-500" />
                          <span>{profile.jurisdiction}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs mb-3 pt-3 border-t border-surface-100">
                        <Building2 className="h-3.5 w-3.5 text-surface-400" />
                        <span className="text-surface-600 font-semibold">{profile.institution}</span>
                        <Badge variant="gray" className="!text-[9px] ml-auto">{profile.profile_label.toUpperCase()}</Badge>
                      </div>

                      {profile.committee_membership.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {profile.committee_membership.slice(0, 2).map(c => (
                            <Badge key={c} variant="blue" className="!text-[9px] !px-2">{c}</Badge>
                          ))}
                          {profile.committee_membership.length > 2 && (
                            <Badge variant="gray" className="!text-[9px] !px-2">+{profile.committee_membership.length - 2} more</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const profile = state.profiles.find(p => p.id === id);

  if (!profile) {
    return (
      <div className="text-center py-16">
        <Card className="!p-12 max-w-md mx-auto">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-200/50 mb-5">
            <AlertTriangle className="h-7 w-7 text-surface-400" />
          </div>
          <h3 className="text-xl font-bold text-surface-900 mb-2">Profile Not Found</h3>
          <p className="text-surface-600 mb-6">This profile may have been removed or the link is incorrect.</p>
          <Link to="/profiles" className="btn-primary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Directory
          </Link>
        </Card>
      </div>
    );
  }

  const handleClaim = async () => {
    if (!state.currentUser || state.currentUser.role !== 'representative') {
      alert('Only representative accounts can claim profiles. Please sign in as a representative.');
      return;
    }
    try {
      const result = await api.claimProfile(profile.id);
      dispatch({ type: 'CLAIM_PROFILE', payload: { profileId: profile.id, userId: state.currentUser.id } });
      if (result.profile) dispatch({ type: 'HYDRATE', payload: { profiles: state.profiles.map(p => p.id === profile.id ? result.profile : p) } });
      alert('Profile claimed. An administrator must verify it.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to claim this profile.');
    }
  };

  const verificationVariant =
    profile.verification_status === 'unclaimed' ? 'gray' :
    profile.verification_status === 'verified and active' ? 'green' :
    'yellow';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <nav className="mb-2">
        <Link to="/profiles" className="inline-flex items-center gap-2 text-sm font-bold text-primary-600 hover:text-primary-700 transition-colors">
          <ArrowLeft className="h-4 w-4" /> All Profiles
        </Link>
      </nav>

      <Card className="!p-0 relative overflow-hidden border-0">
        <div className="relative bg-gradient-to-br from-primary-600 via-primary-700 to-accent-600 px-7 md:px-8 py-8 md:py-10 overflow-hidden">
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '30px 30px'
          }} />
          <div className="absolute -top-20 -right-16 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full bg-accent-400/20 blur-3xl" />

          <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-xl shadow-black/10 shrink-0">
                <Users className="h-8 w-8 md:h-10 md:w-10" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-tight mb-1">{profile.office}</h1>
                <div className="flex items-center gap-1.5 text-white/85 font-medium">
                  <MapPin className="h-4 w-4" />
                  <span>{profile.jurisdiction}</span>
                </div>
              </div>
            </div>
            <Badge
              variant={verificationVariant as any}
              showIcon
              className="!text-[11px] !py-1.5 !px-3 self-start md:self-auto shadow-lg shadow-black/10"
            >
              {profile.verification_status}
            </Badge>
          </div>
        </div>

        <div className="relative px-7 md:px-8 py-7 md:py-8">
          <DisclaimerBox className="mb-6 !p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warm-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm">
                  These are platform activity labels only. They are not legal findings, electoral judgments, or allegations of corruption.
                </p>
              </div>
            </div>
          </DisclaimerBox>

          <div className="space-y-5">
            <div>
              <div className="inline-flex items-center gap-2 mb-2.5">
                <Building2 className="h-4 w-4 text-primary-500" />
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-surface-500">Institution</h3>
              </div>
              <p className="text-base font-semibold text-surface-900">{profile.institution}</p>
            </div>

            <div>
              <div className="inline-flex items-center gap-2 mb-2.5">
                <Shield className="h-4 w-4 text-primary-500" />
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-surface-500">Profile Label</h3>
              </div>
              <div className="mb-2">
                <Badge variant="gray" className="!text-[11px] !py-1">{profile.profile_label.toUpperCase()}</Badge>
              </div>
              <p className="text-sm text-surface-600 leading-relaxed">
                {profile.profile_label === 'unclaimed' && 'Built from public institutional data. Not yet claimed by the office holder.'}
                {profile.profile_label === 'verified' && 'Claimed and verified by an administrator.'}
                {profile.profile_label === 'simulated' && 'This is a demo/simulated profile for testing.'}
                {profile.profile_label === 'pilot' && 'This is a pilot-phase verified profile.'}
              </p>
            </div>

            <div>
              <div className="inline-flex items-center gap-2 mb-2.5">
                <Users className="h-4 w-4 text-primary-500" />
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-surface-500">Committee Membership</h3>
              </div>
              {profile.committee_membership.length === 0 ? (
                <p className="text-sm text-surface-500 italic">No committee memberships listed.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {profile.committee_membership.map(c => (
                    <Badge key={c} variant="blue" className="!text-[11px] !px-3 !py-1">{c}</Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="inline-flex items-center gap-2 mb-2.5">
                <Info className="h-4 w-4 text-primary-500" />
                <h3 className="text-xs font-black uppercase tracking-[0.15em] text-surface-500">Contact Channels</h3>
              </div>
              {profile.contact_channels.length === 0 ? (
                <p className="text-sm text-surface-500 italic">No contact channels listed.</p>
              ) : (
                <div className="space-y-2">
                  {profile.contact_channels.map((ch, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 border border-surface-100">
                      <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                        {ch.type.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-surface-500">{ch.type}</div>
                        <div className="text-sm font-semibold text-surface-900">{ch.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {profile.verification_status === 'unclaimed' && (
            <div className="mt-7 pt-6 border-t border-surface-100">
              <button onClick={handleClaim} className="btn-primary inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Claim This Profile
              </button>
              <p className="text-xs text-surface-500 mt-3 leading-relaxed max-w-md">
                Only the actual office holder should claim this profile. An administrator will verify the claim before the profile status changes.
              </p>
            </div>
          )}
        </div>
      </Card>

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-primary-900 mb-1">About Profiles</h3>
            <p className="text-sm text-primary-800/85 leading-relaxed">
              This platform works fully with zero claimed profiles (adoption-independence).
              Representative profiles are additive and cannot retroactively construct a responsiveness record.
              Joining preserves timestamps and full audit history.
            </p>
          </div>
        </div>
      </InfoBox>
    </div>
  );
}

export function ClaimProfilePage() {
  const { state, dispatch } = useApp();
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const isRepresentative = state.currentUser?.role === 'representative';
  const availableProfiles = state.profiles.filter(profile =>
    profile.verification_status === 'unclaimed' && (!profile.user_id || profile.user_id === state.currentUser?.id)
  );

  const claimProfile = async (profileId: string) => {
    if (!state.currentUser || !isRepresentative) return;
    try {
      await api.claimProfile(profileId);
      dispatch({ type: 'CLAIM_PROFILE', payload: { profileId, userId: state.currentUser.id } });
      setClaimedId(profileId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to claim this profile.');
    }
  };

  return (
    <div className="w-full space-y-8">
      <header className="max-w-4xl">
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-8 h-px bg-gradient-to-r from-primary-500 to-accent-500 rounded-full" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-primary-600">Representative Access</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-surface-900 mb-4">Claim your <span className="gradient-text">profile</span></h1>
        <p className="text-lg text-surface-600 leading-relaxed">Find the public office profile that matches your role. A claim is sent for administrator review; it does not change published receipts or outcomes.</p>
      </header>

      <InfoBox className="!p-5">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">Only representatives can request a claim. Profile details remain public, and claims stay pending until an administrator verifies the office, jurisdiction, and contact channels.</p>
        </div>
      </InfoBox>

      {!isRepresentative && (
        <Card className="!p-6 md:!p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-surface-900 mb-1">Representative sign-in required</h2>
              <p className="text-sm text-surface-600">Sign in with a representative account to submit a profile claim.</p>
            </div>
            <Link to="/signin" className="btn-primary inline-flex items-center gap-2 self-start sm:self-auto"><ArrowRight className="h-4 w-4" /> Sign in</Link>
          </div>
        </Card>
      )}

      {availableProfiles.length === 0 ? (
        <Card className="!p-8 md:!p-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface-100 text-surface-500"><UserRoundPlus className="h-6 w-6" /></div>
          <h2 className="text-xl font-black text-surface-900 mb-2">No profiles available to claim</h2>
          <p className="text-sm text-surface-600">All available profiles are already claimed or awaiting verification.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
          {availableProfiles.map(profile => {
            const isClaimedByUser = Boolean(state.currentUser && profile.user_id === state.currentUser.id);
            const isSubmitted = claimedId === profile.id || isClaimedByUser;
            return (
              <Card key={profile.id} className="!p-0 h-full overflow-hidden">
                <div className="p-6 md:p-8 h-full flex flex-col">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary-100 to-accent-100 text-primary-700 ring-4 ring-white shadow-md"><Building2 className="h-6 w-6" /></div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl md:text-2xl font-black text-surface-900 leading-snug break-words">{profile.office}</h2>
                      <p className="mt-1 flex items-start gap-2 text-sm font-semibold text-surface-600"><MapPin className="h-4 w-4 shrink-0 text-primary-600 mt-0.5" /><span>{profile.jurisdiction}</span></p>
                    </div>
                    <Badge variant={isSubmitted ? 'yellow' : 'gray'} className="!text-[9px] !shrink-0">{isSubmitted ? 'Pending review' : 'Unclaimed'}</Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl bg-surface-50 p-4 md:p-5 border border-surface-100 mb-5">
                    <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-surface-500 mb-1">Institution</p><p className="text-sm font-bold text-surface-800 break-words">{profile.institution}</p></div>
                    <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-surface-500 mb-1">Committees</p><p className="text-sm font-semibold text-surface-700 break-words">{profile.committee_membership.length ? profile.committee_membership.join(', ') : 'Not listed'}</p></div>
                  </div>

                  <div className="mt-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <p className="text-xs text-surface-500 leading-relaxed">Administrator verification is required before this profile is marked verified.</p>
                    {isSubmitted ? (
                      <span className="inline-flex items-center gap-2 text-sm font-extrabold text-warm-700"><CheckCircle2 className="h-4 w-4" /> Claim submitted</span>
                    ) : (
                      <button type="button" onClick={() => claimProfile(profile.id)} disabled={!isRepresentative} className="btn-primary inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"><UserRoundPlus className="h-4 w-4" /> Claim profile</button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
