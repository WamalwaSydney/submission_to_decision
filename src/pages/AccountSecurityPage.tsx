import React, { useState } from 'react';
import { Alert, Box, TextField, Typography } from '@mui/material';
import { Copy, Download, KeyRound, ShieldCheck } from 'lucide-react';
import { Card } from '../components/UI';
import { api } from '../api/endpoints';
import { useApp } from '../context/AppContext';

export function AccountSecurityPage() {
  const { state, dispatch } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generate = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage(''); setCodes([]); setBusy(true);
    try {
      const response = await api.generateRecoveryCodes(currentPassword);
      setCodes(response.recovery_codes); setMessage(response.message); setCurrentPassword('');
      if (state.currentUser) {
        const updatedUser = { ...state.currentUser, recovery_codes_configured: true };
        localStorage.setItem('current_user', JSON.stringify(updatedUser));
        dispatch({ type: 'SET_USER', payload: updatedUser });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to generate recovery codes.'); }
    finally { setBusy(false); }
  };
  const saveFile = () => {
    const blob = new Blob([`Participation Trace password recovery codes\nGenerated: ${new Date().toISOString()}\n\n${codes.join('\n')}\n\nEach code works once. Store securely offline. Do not share.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'participation-trace-recovery-codes.txt'; anchor.click(); URL.revokeObjectURL(url);
  };
  return <Box sx={{ maxWidth: 720, mx: 'auto', mt: 3 }}><Card className="!p-6 sm:!p-8">
    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100 text-green-800"><ShieldCheck /></div>
    <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>Account recovery codes</Typography>
    {state.currentUser?.recovery_codes_configured && <Alert severity="success" sx={{ mb: 2 }}>Recovery codes are configured. Generating a replacement set will immediately invalidate every unused code in your current set.</Alert>}
    <Typography sx={{ color: '#526060', lineHeight: 1.7, mb: 3 }}>Generate ten one-time codes while signed in. Save them in a password manager or print them and store them somewhere secure and separate from this device. Each code can reset your password once. After using a recovery code, sign in and generate a new set.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
    {!codes.length && <Box component="form" onSubmit={generate} sx={{ display: 'grid', gap: 2, maxWidth: 460 }}>
      <TextField label="Confirm your current password" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
      <button className="btn-primary inline-flex items-center justify-center gap-2 !py-3" disabled={busy}><KeyRound size={17} />{busy ? 'Generating…' : 'Generate / replace codes'}</button>
    </Box>}
    {!!codes.length && <>
      <Alert severity="warning" sx={{ mb: 2 }}>These codes are shown only now. Generating another set invalidates every code in this set. Do not save them in shared notes, email, or screenshots.</Alert>
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-surface-200 bg-surface-50 p-4 sm:grid-cols-2">{codes.map((code, i) => <code key={code} className="rounded-lg bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider">{String(i + 1).padStart(2, '0')}. {code}</code>)}</div>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={saveFile} className="btn-primary inline-flex items-center gap-2"><Download size={16} />Download codes</button><button type="button" onClick={() => void navigator.clipboard.writeText(codes.join('\n'))} className="btn-secondary inline-flex items-center gap-2"><Copy size={16} />Copy all codes</button></div>
    </>}
  </Card></Box>;
}
