import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Box, Divider, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { Card } from '../components/UI';
import { useApp } from '../context/AppContext';
import { api } from '../api/endpoints';


export function LoginPage() {
  const { dispatch } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');


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

      <Box sx={{ maxWidth: 600, mx: 'auto' }}>
        <Card className="!p-5 sm:!p-7">
          <Typography sx={{ fontSize: 20, fontWeight: 850, color: '#182020', mb: 0.5 }}>Welcome back</Typography>

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

          <Typography sx={{ textAlign: 'center', mt: 2, fontSize: 13 }}>
            <Link to="/reset-password" className="font-bold text-primary-700 hover:text-primary-800">Forgot your password?</Link>
          </Typography>
          <Divider sx={{ my: 2.5, color: '#778181', fontSize: 12 }}>or</Divider>
          <Typography sx={{ textAlign: 'center', color: '#526060', fontSize: 13 }}>
            New to the platform? <Link to="/signup" className="font-extrabold text-primary-700 hover:text-primary-800">Create an account</Link>
          </Typography>
        </Card>
      </Box>
    </Box>
  );
}
