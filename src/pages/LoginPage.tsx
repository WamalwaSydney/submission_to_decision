import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Box, Divider, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { ArrowRight, Eye, EyeOff, FileCheck, Gavel, LockKeyhole, Search, Settings, ShieldCheck, Users } from 'lucide-react';
import { Card } from '../components/UI';
import { useApp } from '../context/AppContext';
import { User, UserRole } from '../types';
import { api } from '../api/endpoints';

const roleIcons: Record<UserRole, React.ReactNode> = {
  citizen: <Users size={17} />,
  representative: <Gavel size={17} />,
  researcher: <Search size={17} />,
  moderator: <ShieldCheck size={17} />,
  clerk: <FileCheck size={17} />,
  administrator: <Settings size={17} />,
};

const roleColors: Record<UserRole, string> = {
  citizen: '#a52d29',
  representative: '#176b2b',
  researcher: '#155f78',
  moderator: '#a66e0b',
  clerk: '#526060',
  administrator: '#641b19',
};

export function LoginPage() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const signInAs = async (user: User) => {
    setError('');
    try {
      const response = await api.login(user.email, 'password123');
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('current_user', JSON.stringify(response.user));
      dispatch({ type: 'SET_USER', payload: response.user });
      navigate('/');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in.');
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const response = await api.login(normalizedEmail, password);
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('current_user', JSON.stringify(response.user));
      dispatch({ type: 'SET_USER', payload: response.user });
      navigate('/');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in.');
    }
  };

  return (
    <Box sx={{ maxWidth: 1040, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', maxWidth: 680, mx: 'auto', mb: { xs: 3, md: 4 } }}>
        <Box sx={{ width: 48, height: 48, mx: 'auto', mb: 2, borderRadius: '15px', display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg,#a52d29,#176b2b)', boxShadow: '0 10px 24px rgba(23,107,43,.18)' }}>
          <LockKeyhole size={21} />
        </Box>
        <Typography sx={{ fontSize: { xs: 32, md: 42 }, fontWeight: 900, letterSpacing: '-.035em', color: '#182020', mb: 1 }}>
          Sign in to <Box component="span" className="gradient-text">Participation Trace</Box>
        </Typography>
        <Typography sx={{ color: '#526060', fontSize: 15, lineHeight: 1.7 }}>
          Continue to your participation dashboard. Public bill and receipt browsing is always open.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: 2.5, md: 3 } }}>
        <Card className="!p-5 sm:!p-7">
          <Typography sx={{ fontSize: 20, fontWeight: 850, color: '#182020', mb: 0.5 }}>Welcome back</Typography>
          <Typography sx={{ color: '#526060', fontSize: 13, mb: 2.5 }}>Use a demo profile available in this browser session.</Typography>

          <Alert severity="info" icon={<LockKeyhole size={17} />} sx={{ mb: 2.5, borderRadius: '12px', '& .MuiAlert-message': { fontSize: 12.5, lineHeight: 1.55 } }}>
            Your password is sent securely to the API over HTTPS and is never stored in the browser.
          </Alert>

          {error && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{error}</Alert>}

          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'grid', gap: 2 }}>
            <TextField
              label="Email address"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
              fullWidth
              autoComplete="email"
              autoFocus
            />
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              fullWidth
              autoComplete="current-password"
              helperText="Use your account password."
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPassword(value => !value)} edge="end" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <button type="submit" className="btn-primary w-full inline-flex items-center justify-center gap-2 !py-3">
              Sign in <ArrowRight className="h-4 w-4" />
            </button>
          </Box>

          <Divider sx={{ my: 2.5, color: '#778181', fontSize: 12 }}>or</Divider>
          <Typography sx={{ textAlign: 'center', color: '#526060', fontSize: 13 }}>
            New to the pilot? <Link to="/signup" className="font-extrabold text-primary-700 hover:text-primary-800">Create a demo account</Link>
          </Typography>
        </Card>

        <Card className="!p-5 sm:!p-7">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
            <Users size={18} style={{ color: '#176b2b' }} />
            <Typography sx={{ fontSize: 20, fontWeight: 850, color: '#182020' }}>Quick demo access</Typography>
          </Box>
          <Typography sx={{ color: '#526060', fontSize: 13, mb: 2.5 }}>Choose a sample role to explore its tools. These accounts are simulated.</Typography>

          {state.users.length > 0 ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
              {state.users.map(user => (
                <Box
                  key={user.id}
                  component="button"
                  type="button"
                  onClick={() => signInAs(user)}
                  sx={{
                    minWidth: 0,
                    minHeight: 66,
                    p: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    textAlign: 'left',
                    border: '1px solid #e2ded5',
                    borderRadius: '13px',
                    background: '#fff',
                    color: '#182020',
                    cursor: 'pointer',
                    transition: 'border-color .18s ease, background .18s ease, transform .18s ease',
                    '&:hover': { borderColor: roleColors[user.role], background: '#fffdf8', transform: 'translateY(-1px)' },
                    '&:focus-visible': { outline: '3px solid rgba(201,139,24,.45)', outlineOffset: 2 },
                  }}
                >
                  <Avatar sx={{ width: 34, height: 34, bgcolor: roleColors[user.role], flexShrink: 0 }}>{roleIcons[user.role]}</Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.3 }}>{user.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: '#526060', textTransform: 'capitalize' }}>{user.role}</Typography>
                  </Box>
                  <ArrowRight size={15} style={{ flexShrink: 0, color: '#8b9694' }} />
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ py: 3, color: '#526060', fontSize: 14 }}>No sample accounts are available in this session. Create a demo account to continue.</Typography>
          )}

          <Typography sx={{ mt: 2, color: '#778181', fontSize: 11.5, lineHeight: 1.55 }}>
            Signing in with a sample account switches the current demo role for this session only.
          </Typography>
        </Card>
      </Box>
    </Box>
  );
}
