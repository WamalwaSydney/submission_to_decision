import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Box, IconButton, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRoundPlus } from 'lucide-react';
import { Card } from '../components/UI';
import { useApp } from '../context/AppContext';
import { UserRole } from '../types';
import { api } from '../api/endpoints';

export function SignupPage() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('citizen');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) {
      setError('Enter your name to create a profile.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    try {
      const response = await api.register(normalizedName, normalizedEmail, password, role as 'citizen' | 'representative');
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('current_user', JSON.stringify(response.user));
      dispatch({ type: 'SET_USER', payload: response.user });
      navigate('/');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to create the account.');
    }
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 3.5 }}>
        <Box sx={{ width: 48, height: 48, mx: 'auto', mb: 2, borderRadius: '15px', display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg,#a52d29,#176b2b)', boxShadow: '0 10px 24px rgba(23,107,43,.18)' }}>
          <UserRoundPlus size={21} />
        </Box>
        <Typography sx={{ fontSize: { xs: 32, md: 42 }, fontWeight: 900, letterSpacing: '-.035em', color: '#182020', mb: 1 }}>
          Create your <Box component="span" className="gradient-text">account</Box>
        </Typography>
        <Typography sx={{ color: '#526060', fontSize: 15, lineHeight: 1.7 }}>
          Join the participation-trace pilot. Browsing bills and receipts remains open to everyone.
        </Typography>
      </Box>

      <Card className="!p-5 sm:!p-7">
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'grid', gap: 2 }}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <TextField label="Full name" value={name} onChange={event => setName(event.target.value)} required fullWidth autoComplete="name" autoFocus />
          <TextField label="Email address" type="email" value={email} onChange={event => setEmail(event.target.value)} required fullWidth autoComplete="email" />
          <TextField select label="Account type" value={role} onChange={event => setRole(event.target.value as UserRole)} fullWidth>
            <MenuItem value="citizen">Citizen</MenuItem>
            <MenuItem value="representative">Representative / office holder</MenuItem>
          </TextField>
          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
            fullWidth
            autoComplete="new-password"
            helperText="At least 8 characters. It will be sent securely to the API."
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

          <Alert severity="info" icon={<LockKeyhole size={17} />} sx={{ borderRadius: '12px', '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.55 } }}>
            Your account and password are stored and verified by the backend. Never use a password you reuse elsewhere for a demo environment.
          </Alert>

          <button type="submit" className="btn-primary w-full inline-flex items-center justify-center gap-2 !py-3">
            Create demo account <ArrowRight className="h-4 w-4" />
          </button>
        </Box>
      </Card>

      <Typography sx={{ textAlign: 'center', mt: 2.5, color: '#526060', fontSize: 13 }}>
        Already have an account? <Link to="/signin" className="font-extrabold text-primary-700 hover:text-primary-800">Sign in</Link>
      </Typography>
    </Box>
  );
}
