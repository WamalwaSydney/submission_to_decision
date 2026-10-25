import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Box, IconButton, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { ArrowRight, Copy, Download, Eye, EyeOff, LockKeyhole, UserRoundPlus } from 'lucide-react';
import { Card } from '../components/UI';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';

type PublicSignupRole = 'citizen' | 'committee_officer' | 'reviewer' | 'administrator';

const ROLE_OPTIONS: { value: PublicSignupRole; label: string }[] = [
  { value: 'citizen', label: 'Citizen / public participant' },
  { value: 'committee_officer', label: 'Clerk’s Office / Committee Secretariat' },
];

export function SignupPage() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PublicSignupRole>('citizen');
  const [notificationLanguage, setNotificationLanguage] = useState<'en' | 'sw'>('en');
  const [committeeId, setCommitteeId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [committeesLoading, setCommitteesLoading] = useState(true);
  const [committeesError, setCommitteesError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCommitteesLoading(true);
    setCommitteesError('');
    api.committees()
      .then(({ committees }) => {
        if (!cancelled) dispatch({ type: 'HYDRATE', payload: { committees } });
      })
      .catch(error => {
        if (!cancelled) setCommitteesError(error instanceof Error ? error.message : 'Unable to load synced committees.');
      })
      .finally(() => {
        if (!cancelled) setCommitteesLoading(false);
      });
    return () => { cancelled = true; };
  }, [dispatch]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) {
      setError('Enter your name to create a profile.');
      return;
    }
    if (password.length < 12) {
      setError('Use a password with at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (role === 'committee_officer' && !committeeId) {
      setError('Select the official committee you work for.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.register(normalizedName, normalizedEmail, password, role, {
        notification_language: notificationLanguage,
        ...(role === 'committee_officer' ? { committee_id: committeeId } : {}),
      });
      if (!response.recovery_codes?.length) throw new Error('The recovery codes were not returned. Contact support before leaving this page.');
      if (response.status === 'pending_approval') {
        setPendingApproval(true);
        setSuccessMessage(response.message || 'Your access request is pending administrator approval. Save the recovery codes before leaving this page.');
        setRecoveryCodes(response.recovery_codes);
        return;
      }
      if (!response.access_token || !response.user) throw new Error('The registration response was incomplete. Please try again.');
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('current_user', JSON.stringify(response.user));
      dispatch({ type: 'SET_USER', payload: response.user });
      setRecoveryCodes(response.recovery_codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 3.5 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            mx: 'auto',
            mb: 2,
            borderRadius: '15px',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: 'linear-gradient(135deg,#a52d29,#176b2b)',
            boxShadow: '0 10px 24px rgba(23,107,43,.18)',
          }}
        >
          <UserRoundPlus size={21} />
        </Box>
        <Typography sx={{ fontSize: { xs: 32, md: 42 }, fontWeight: 900, letterSpacing: '-.035em', color: '#182020', mb: 1 }}>
          Create your <Box component="span" className="gradient-text">account</Box>
        </Typography>
        <Typography sx={{ color: '#526060', fontSize: 15, lineHeight: 1.7 }}>
          Join the participation-trace platform. Browsing bills and receipts remains open to everyone.
        </Typography>
      </Box>

      <Card className="!p-5 sm:!p-7">
        {recoveryCodes.length ? <Box sx={{ display: 'grid', gap: 2 }}>
          <Alert severity="warning" role="alert">These ten one-time recovery codes were created with your account and are shown only now. Save them offline before continuing. We store only their hashes, so we cannot show them again.</Alert>
          {successMessage && <Alert severity="success" role="status">{successMessage}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, p: 2, border: '1px solid #d7e0e0', borderRadius: 2, background: '#f7faf9' }}>
            {recoveryCodes.map((code, index) => <Box key={code} component="code" sx={{ fontFamily: 'monospace', fontWeight: 800, p: 1, background: '#fff', borderRadius: 1 }}>{String(index + 1).padStart(2, '0')}. {code}</Box>)}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { const blob = new Blob([`Participation Trace recovery codes\n\n${recoveryCodes.join('\n')}\n\nEach code works once. Store securely offline.\n`], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'participation-trace-recovery-codes.txt'; a.click(); URL.revokeObjectURL(url); }} className="btn-secondary inline-flex items-center gap-2"><Download size={16} />Download codes</button>
            <button type="button" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join('\n'))} className="btn-secondary inline-flex items-center gap-2"><Copy size={16} />Copy codes</button>
          </Box>
          <button type="button" onClick={() => { setRecoveryCodes([]); if (pendingApproval) navigate('/signin'); else navigate('/'); }} className="btn-primary w-full !py-3">I saved these codes — continue</button>
        </Box> : <Box component="form" onSubmit={handleSubmit} sx={{ display: 'grid', gap: 2 }}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          {successMessage && <Alert severity="success" role="status">{successMessage} <Link to="/signin" className="font-bold underline">Go to sign in</Link>.</Alert>}

          <TextField
            label="Full name"
            value={name}
            onChange={event => setName(event.target.value)}
            required
            fullWidth
            autoComplete="name"
            autoFocus
          />
          <TextField
            label="Email address"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
            fullWidth
            autoComplete="email"
          />
          <TextField
            select
            label="Account type"
            value={role}
            onChange={event => setRole(event.target.value as PublicSignupRole)}
            fullWidth
          >
            {ROLE_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Notification language"
            value={notificationLanguage}
            onChange={event => setNotificationLanguage(event.target.value as 'en' | 'sw')}
            fullWidth
            helperText="Automated in-app updates will use this language. You can change it later."
          >
            <MenuItem value="en">English</MenuItem>
            <MenuItem value="sw">Kiswahili</MenuItem>
          </TextField>

          {role === 'committee_officer' && (
            <>
              <Alert severity="info" sx={{ borderRadius: '12px' }}>
                Select the existing committee record synced from Parliament. An administrator must approve your Clerk’s Office access before you can sign in.
              </Alert>
              <TextField
                select
                label="Your committee"
                value={committeeId}
                onChange={event => setCommitteeId(event.target.value)}
                required
                fullWidth
                helperText={committeesLoading ? 'Loading synced committees from Parliament…' : committeesError ? committeesError : state.committees.length ? 'Your account will only access this committee’s workspace.' : 'No synced committees are available yet.'}
              >
                <MenuItem value="">{committeesLoading ? 'Loading synced committees…' : 'Select a committee'}</MenuItem>
                {state.committees.map(committee => <MenuItem key={committee.id} value={committee.id}>{committee.name} — {committee.institution}</MenuItem>)}
              </TextField>
            </>
          )}

          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
            fullWidth
            autoComplete="new-password"
            helperText="At least 12 characters (maximum 128). Choose a unique password."
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(value => !value)}
                      edge="end"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            label="Confirm password"
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            required
            fullWidth
            autoComplete="new-password"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowConfirmPassword(value => !value)}
                      edge="end"
                      aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <Alert
            severity="info"
            icon={<LockKeyhole size={17} />}
            sx={{ borderRadius: '12px', '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.55 } }}
          >
            Your account and password are stored and verified by the backend. Never use a
            password you reuse elsewhere for this service.
          </Alert>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 !py-3"
          >
            {submitting ? 'Submitting...' : role === 'committee_officer' ? 'Request Clerk’s Office access' : 'Create account'}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>
        </Box>}
      </Card>

      <Typography sx={{ textAlign: 'center', mt: 2.5, color: '#526060', fontSize: 13 }}>
        Already have an account?{' '}
        <Link to="/signin" className="font-extrabold text-primary-700 hover:text-primary-800">
          Sign in
        </Link>
      </Typography>
    </Box>
  );
}
