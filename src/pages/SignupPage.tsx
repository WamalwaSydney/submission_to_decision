import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Box, IconButton, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRoundPlus } from 'lucide-react';
import { Card } from '../components/UI';
import { useApp } from '../context/AppContext';
import { api, SignupRole } from '../api/endpoints';

type PublicSignupRole = SignupRole;

const ROLE_OPTIONS: { value: PublicSignupRole; label: string }[] = [
  { value: 'citizen', label: 'Citizen / public participant' },
  { value: 'committee_officer', label: 'Committee Officer' },
  { value: 'reviewer', label: 'Independent Reviewer' },
  { value: 'administrator', label: 'Platform Administrator' },
];

const ELEVATED: PublicSignupRole[] = ['committee_officer', 'reviewer', 'administrator'];

export function SignupPage() {
  const { dispatch } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PublicSignupRole>('citizen');
  const [notificationLanguage, setNotificationLanguage] = useState<'en' | 'sw'>('en');
  const [committeeName, setCommitteeName] = useState('');
  const [institution, setInstitution] = useState('National Assembly');
  const [committeeDescription, setCommitteeDescription] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

    setSubmitting(true);
    try {
      const response = await api.register(normalizedName, normalizedEmail, password, role, {
        notification_language: notificationLanguage,
        ...(role === 'committee_officer' ? {
          committee_name: committeeName.trim() || undefined,
          institution,
          committee_description: committeeDescription.trim() || undefined,
          committee_contact_email: normalizedEmail,
        } : {}),
      });
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('current_user', JSON.stringify(response.user));
      dispatch({ type: 'SET_USER', payload: response.user });
      navigate('/');
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
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'grid', gap: 2 }}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}

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
                Your committee organization and officer workspace will be created automatically when you sign up.
              </Alert>
              <TextField
                label="Committee name"
                value={committeeName}
                onChange={event => setCommitteeName(event.target.value)}
                placeholder="e.g. Budget and Appropriations Committee"
                required
                fullWidth
              />
              <TextField
                select
                label="Institution"
                value={institution}
                onChange={event => setInstitution(event.target.value)}
                fullWidth
              >
                <MenuItem value="National Assembly">National Assembly</MenuItem>
                <MenuItem value="Nairobi County Assembly">Nairobi County Assembly</MenuItem>
                <MenuItem value="Trans Nzoia County Assembly">Trans Nzoia County Assembly</MenuItem>
              </TextField>
              <TextField
                label="Committee description"
                value={committeeDescription}
                onChange={event => setCommitteeDescription(event.target.value)}
                multiline
                minRows={2}
                fullWidth
              />
            </>
          )}

          {ELEVATED.includes(role) && (
            <Alert severity="warning" sx={{ borderRadius: '12px' }}>
              This role has elevated platform permissions. Use it only for the responsibilities
              described in the platform workflow.
            </Alert>
          )}

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

          <Alert
            severity="info"
            icon={<LockKeyhole size={17} />}
            sx={{ borderRadius: '12px', '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.55 } }}
          >
            Your account and password are stored and verified by the backend. Never use a
            password you reuse elsewhere for a demo environment.
          </Alert>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full inline-flex items-center justify-center gap-2 !py-3"
          >
            {submitting ? 'Creating account...' : 'Create demo account'}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>
        </Box>
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
