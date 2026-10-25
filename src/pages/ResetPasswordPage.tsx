import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, TextField, Typography } from '@mui/material';
import { Card } from '../components/UI';
import { api } from '../api/endpoints';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adminToken = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    if (password.length < 12) { setError('Use at least 12 characters.'); return; }
    setBusy(true);
    try {
      const result = adminToken
        ? await api.resetPassword(adminToken, password)
        : await api.resetWithRecoveryCode({ email: email.trim().toLowerCase(), recovery_code: recoveryCode.trim().toLowerCase(), password });
      setMessage(result.message);
      window.setTimeout(() => navigate('/signin'), 1600);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to process the request.'); }
    finally { setBusy(false); }
  };
  return <Box sx={{ maxWidth: 560, mx: 'auto', mt: 4 }}><Card className="!p-6 sm:!p-8">
    <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>Reset your password</Typography>
    <Typography sx={{ color: '#526060', mb: 3 }}>{adminToken ? 'Use the administrator-issued one-time link.' : 'Use one of the offline recovery codes you saved. Each code works once.'}</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2 }}>
      {!adminToken && <>
        <TextField label="Account email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        <TextField label="One-time recovery code" value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} required slotProps={{ htmlInput: { minLength: 32, maxLength: 32, autoCapitalize: 'none', autoCorrect: 'off' } }} autoComplete="off" helperText="Enter one 32-character code from your saved recovery set." />
      </>}
      <TextField label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} required slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} autoComplete="new-password" helperText="12–128 characters" />
      <TextField label="Confirm new password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
      <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Please wait…' : 'Update password'}</button>
    </Box>
    <Typography sx={{ mt: 2, textAlign: 'center', fontSize: 13 }}><Link to="/signin" className="font-bold text-primary-700">Back to sign in</Link></Typography>
  </Card></Box>;
}
