import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  Shield,
  FileText,
  CheckCircle2,
  BarChart3,
  Send,
  Search,
  Fingerprint,
  Gavel,
  BookOpen,
  Globe2,
  Users,
  Sparkles,
  Scale,
  ArrowRight,
  Clock3,
  BadgeCheck,
  PencilLine,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Box,
  Typography,
  Avatar,
  alpha,
  useTheme,
} from '@mui/material';
import { Badge, StatCard, SectionHeader, DisclaimerBox, InfoBox, Card } from '../components/UI';

const tonePalette = {
  primary: {
    bg: `radial-gradient(ellipse at top, ${alpha('#6366F1', 0.09)}, transparent 62%)`,
    iconBg: 'linear-gradient(135deg, #6366F1, #4338CA)',
    shadow: `0 14px 32px -8px ${alpha('#6366F1', 0.45)}`,
    glow: '#6366F1',
  },
  accent: {
    bg: `radial-gradient(ellipse at top, ${alpha('#14B8A6', 0.09)}, transparent 62%)`,
    iconBg: 'linear-gradient(135deg, #14B8A6, #0F766E)',
    shadow: `0 14px 32px -8px ${alpha('#14B8A6', 0.45)}`,
    glow: '#14B8A6',
  },
  warm: {
    bg: `radial-gradient(ellipse at top, ${alpha('#D97706', 0.09)}, transparent 62%)`,
    iconBg: 'linear-gradient(135deg, #F59E0B, #B45309)',
    shadow: `0 14px 32px -8px ${alpha('#F59E0B', 0.45)}`,
    glow: '#F59E0B',
  },
  purple: {
    bg: `radial-gradient(ellipse at top, ${alpha('#A855F7', 0.09)}, transparent 62%)`,
    iconBg: 'linear-gradient(135deg, #A855F7, #7C3AED)',
    shadow: `0 14px 32px -8px ${alpha('#A855F7', 0.45)}`,
    glow: '#A855F7',
  },
};

export function HomePage() {
  const { state } = useApp();
  const totalReceipts = state.receipts.length;
  const totalBills = state.bills.length;
  const confirmedMatches = state.matches.filter(m => m.reviewer_decision === 'confirmed').length;
  const theme = useTheme();
  const palPrimary = theme.palette.primary as any;
  const palSecondary = theme.palette.secondary as any;
  const palSaffron = (theme.palette.saffron || theme.palette.warning) as any;
  const ink = theme.palette.ink as any;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 10, md: 14 } }}>
      {/* ============== HERO ============== */}
      <Box
        component="section"
        sx={{
          position: 'relative',
          mx: { xs: -2, sm: -3, lg: -4 },
          px: { xs: 2, sm: 3, lg: 4 },
          pt: { xs: 2, md: 4 },
          pb: { xs: 12, md: 16 },
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <Box
            className="hero-blob animate-float-slow"
            sx={{
              width: 720,
              height: 720,
              top: -280,
              right: -220,
              background: `radial-gradient(circle, ${palPrimary.main}, transparent 70%)`,
              opacity: 0.17,
            }}
          />
          <Box
            className="hero-blob animate-float-slow"
            sx={{
              width: 600,
              height: 600,
              top: 90,
              left: -240,
              background: `radial-gradient(circle, ${palSecondary.main}, transparent 70%)`,
              opacity: 0.14,
              animationDelay: '2.3s',
            }}
          />
          <Box
            className="hero-blob animate-float-slow"
            sx={{
              width: 420,
              height: 420,
              bottom: -140,
              left: '42%',
              background: `radial-gradient(circle, ${palSaffron.main}, transparent 70%)`,
              opacity: 0.10,
              animationDelay: '4.6s',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: 0.032,
              backgroundImage:
                'linear-gradient(rgb(15 23 42) 1px, transparent 1px), linear-gradient(90deg, rgb(15 23 42) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
            }}
          />
        </Box>

        <Box sx={{ position: 'relative', maxWidth: 900, mx: 'auto', textAlign: 'center' }}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.25,
                py: 1.1,
                borderRadius: 999,
                background: alpha('#fff', 0.82),
                backdropFilter: 'blur(14px)',
                border: `1px solid ${alpha('#E2E8F0', 0.9)}`,
                boxShadow: `0 4px 14px -4px ${alpha('#0F172A', 0.08)}`,
                mb: 8,
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: palSecondary[400],
                    opacity: 0.72,
                  }}
                  className="animate-pulse-ring"
                />
                <Box
                  sx={{
                    position: 'relative',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: palSecondary[500],
                  }}
                />
              </Box>
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: ink[600],
                }}
              >
                Pilot Launch · Kenya 2026
              </Typography>
              <Badge variant="accent" sx={{ fontSize: 10 }}>
                LIVE
              </Badge>
            </Box>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <Typography
              sx={{
                fontSize: { xs: 42, sm: 56, md: 66, lg: 76 },
                fontWeight: 900,
                letterSpacing: '-0.035em',
                color: ink[900],
                mb: 4,
                lineHeight: 1.02,
              }}
            >
              Every submission.
              <Box
                component="span"
                className="gradient-text"
                sx={{ display: 'block' }}
              >
                Traceable to decision.
              </Box>
            </Typography>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Typography
              sx={{
                fontSize: { xs: 16, md: 19 },
                color: ink[600],
                maxWidth: 720,
                mx: 'auto',
                mb: 10,
                lineHeight: 1.75,
                fontWeight: 500,
              }}
            >
              A tamper-evident platform for verifying public participation outcomes in Kenya's National and County Legislatures.
              Submit your views on tracked bills and follow every step — from receipt to committee decision.
            </Typography>
          </motion.div>

          {/* Quick trust badges */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                gap: { xs: 3, md: 6 },
                mb: 10,
              }}
            >
              {[
                { icon: <Fingerprint size={15} />, text: 'Hash-chained receipts' },
                { icon: <Scale size={15} />, text: 'Constitution-aligned' },
                { icon: <Shield size={15} />, text: 'Independent of officials' },
              ].map((t, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: 2,
                      background: `linear-gradient(135deg, ${alpha('#6366F1', 0.12)}, ${alpha('#14B8A6', 0.12)})`,
                      border: `1px solid ${alpha('#6366F1', 0.22)}`,
                      color: '#3730A3',
                    }}
                    variant="square"
                  >
                    <Box sx={{ display: 'flex', color: '#3730A3' }}>{t.icon}</Box>
                  </Avatar>
                  <Typography
                    sx={{ fontWeight: 700, color: ink[600], fontSize: 14 }}
                  >
                    {t.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: { xs: 2, md: 3 },
                mb: 14,
              }}
            >
              <Box
                component={Link}
                to="/submit"
                className="animate-glow-pulse"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.35,
                  px: { xs: 5, md: 7 },
                  py: { xs: 1.85, md: 2.2 },
                  borderRadius: 4,
                  fontSize: { xs: 14.5, md: 16 },
                  fontWeight: 700,
                  color: '#fff',
                  textDecoration: 'none',
                  background:
                    `linear-gradient(135deg, ${palPrimary[600]} 0%, ${palPrimary[500]} 45%, ${palSecondary[600]} 100%)`,
                  backgroundSize: '200% 200%',
                  backgroundPosition: '0% 50%',
                  boxShadow: `0 10px 28px -6px ${alpha(palPrimary[500], 0.5)}, inset 0 1px 0 ${alpha('#fff', 0.2)}`,
                  transition: 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    backgroundPosition: '100% 50%',
                    transform: 'translateY(-1.5px)',
                    boxShadow: `0 22px 48px -10px ${alpha(palPrimary[500], 0.64)}, inset 0 1px 0 ${alpha('#fff', 0.24)}`,
                  },
                  '&:active': { transform: 'translateY(0)' },
                }}
              >
                <Send size={17} /> Submit Your View
              </Box>

              <Box
                component={Link}
                to="/bills"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.35,
                  px: { xs: 5, md: 7 },
                  py: { xs: 1.85, md: 2.2 },
                  borderRadius: 4,
                  fontSize: { xs: 14.5, md: 16 },
                  fontWeight: 700,
                  color: ink[700],
                  textDecoration: 'none',
                  background: alpha('#fff', 0.82),
                  backdropFilter: 'blur(12px)',
                  border: `1px solid ${alpha('#E2E8F0', 0.9)}`,
                  transition: 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '&:hover': {
                    background: '#fff',
                    borderColor: alpha(palPrimary[500], 0.24),
                    color: palPrimary[700],
                    transform: 'translateY(-1.5px)',
                    boxShadow: `0 16px 34px -10px ${alpha('#0F172A', 0.14)}`,
                  },
                  '&:active': { transform: 'translateY(0)' },
                }}
              >
                <Gavel size={17} /> Browse Bills
              </Box>

              <Box
                component={Link}
                to="/receipt-lookup"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.35,
                  px: { xs: 5, md: 7 },
                  py: { xs: 1.85, md: 2.2 },
                  borderRadius: 4,
                  fontSize: { xs: 14.5, md: 16 },
                  fontWeight: 700,
                  color: ink[700],
                  textDecoration: 'none',
                  background: alpha('#fff', 0.82),
                  backdropFilter: 'blur(12px)',
                  border: `1px solid ${alpha('#E2E8F0', 0.9)}`,
                  transition: 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '&:hover': {
                    background: '#fff',
                    borderColor: alpha(palSecondary[500], 0.24),
                    color: palSecondary[700],
                    transform: 'translateY(-1.5px)',
                    boxShadow: `0 16px 34px -10px ${alpha('#0F172A', 0.14)}`,
                  },
                  '&:active': { transform: 'translateY(0)' },
                }}
              >
                <Search size={17} /> Look Up Receipt
              </Box>
            </Box>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: { xs: 3, md: 5 },
              }}
            >
              <StatCard icon={<FileText size={24} />} value={totalBills} label="Bills Tracked" tone="primary" badge="Simulated Data" />
              <StatCard icon={<CheckCircle2 size={24} />} value={totalReceipts} label="Receipts Issued" tone="accent" />
              <StatCard icon={<BarChart3 size={24} />} value={confirmedMatches} label="Confirmed Matches" tone="warm" />
            </Box>
          </motion.div>
        </Box>
      </Box>

      {/* ============== HOW IT WORKS ============== */}
      <Box component="section" sx={{ position: 'relative' }}>
        <Box sx={{ maxWidth: 900, mx: 'auto' }}>
          <SectionHeader
            eyebrow="The Process"
            title="From submission to published outcome"
            subtitle="Four simple steps — every action is recorded, every link is verifiable."
            align="center"
          />
        </Box>

        <Box sx={{ position: 'relative', mt: 12 }}>
          <Box
            sx={{
              display: { xs: 'none', lg: 'block' },
              position: 'absolute',
              top: 72,
              left: '12%',
              right: '12%',
              height: 2,
              zIndex: 0,
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(90deg, ${alpha('#6366F1', 0.35)}, ${alpha('#14B8A6', 0.45)}, ${alpha('#F59E0B', 0.35)}, ${alpha('#A855F7', 0.35)})`,
                borderRadius: 999,
                opacity: 0.5,
              }}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: { xs: 3, md: 4 },
            }}
          >
            {[
              { n: 1, title: 'Submit Your View', desc: 'Choose a tracked bill, optionally reference a clause, and write your submission.', icon: <Send size={22} />, tone: 'primary' as const },
              { n: 2, title: 'Receive a Receipt', desc: 'Get a timestamped, hash-chained proof of submission you can independently verify.', icon: <Fingerprint size={22} />, tone: 'accent' as const },
              { n: 3, title: 'Report Ingested', desc: 'When a committee report is published, it is extracted and matches are proposed.', icon: <BookOpen size={22} />, tone: 'warm' as const },
              { n: 4, title: 'Outcome Published', desc: 'A human moderator confirms matches. Outcomes are published with stated reasons.', icon: <CheckCircle2 size={22} />, tone: 'purple' as const },
            ].map((step, i) => {
              const tone = tonePalette[step.tone];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.52, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Card sx={{ p: 0, height: '100%', position: 'relative', overflow: 'hidden' }}>
                    <Box
                      sx={{
                        p: { xs: 5, md: 6 },
                        textAlign: 'center',
                        position: 'relative',
                        height: '100%',
                        '&:hover .step-card-hover-bg': { opacity: 1 },
                      }}
                    >
                      <Box
                        className="step-card-hover-bg"
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          opacity: 0,
                          transition: 'opacity 520ms ease',
                          background: tone.bg,
                        }}
                      />
                      <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', mb: 6 }}>
                        <Avatar
                          sx={{
                            width: 64,
                            height: 64,
                            borderRadius: 4,
                            background: tone.iconBg,
                            color: '#fff',
                            boxShadow: tone.shadow,
                            position: 'relative',
                          }}
                          variant="square"
                        >
                          {step.icon}
                        </Avatar>
                        <Box
                          sx={{
                            position: 'absolute',
                            top: -10,
                            right: 'calc(50% - 44px)',
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background: '#fff',
                            border: '2px solid #fff',
                            fontWeight: 900,
                            fontSize: 11,
                            color: ink[800],
                            boxShadow: `0 6px 14px -4px ${alpha('#0F172A', 0.18)}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {step.n}
                        </Box>
                      </Box>
                      <Typography
                        sx={{
                          position: 'relative',
                          fontSize: 18,
                          fontWeight: 800,
                          letterSpacing: '-0.015em',
                          color: ink[900],
                          mb: 1.5,
                        }}
                      >
                        {step.title}
                      </Typography>
                      <Typography
                        sx={{
                          position: 'relative',
                          fontSize: 13.5,
                          color: ink[600],
                          lineHeight: 1.75,
                          fontWeight: 500,
                        }}
                      >
                        {step.desc}
                      </Typography>
                    </Box>
                  </Card>
                </motion.div>
              );
            })}
          </Box>
        </Box>
      </Box>

      {/* ============== OUTCOME STATUSES ============== */}
      <Box component="section" sx={{ position: 'relative' }}>
        <Box sx={{ maxWidth: 768, mx: 'auto', mb: 8 }}>
          <SectionHeader
            eyebrow="Understanding Results"
            title="Outcome statuses, explained"
            subtitle="Every submission gets a clear, labeled outcome. These are platform activity labels — never legal judgments."
          />
        </Box>

        <Box sx={{ mb: 8, maxWidth: 768, mx: 'auto' }}>
          <DisclaimerBox>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
              <Sparkles size={20} style={{ color: '#92400E', flexShrink: 0, marginTop: 2 }} />
              <Box>
                <Typography sx={{ fontWeight: 500, fontSize: 14, lineHeight: 1.75 }}>
                  <Typography component="strong" sx={{ fontWeight: 800 }}>Important:</Typography>{' '}
                  These are platform activity labels only. They are not legal findings, electoral judgments, or allegations of corruption.
                </Typography>
              </Box>
            </Box>
          </DisclaimerBox>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(5, 1fr)' },
            gap: { xs: 2.5, md: 3 },
          }}
        >
          {[
            { badge: 'awaiting committee report', variant: 'yellow' as const, icon: <Clock3 size={24} />, desc: 'No confirmed match yet. Your submission is waiting for a committee report to be ingested.' },
            { badge: 'adopted', variant: 'green' as const, icon: <BadgeCheck size={24} />, desc: 'The committee adopted your view exactly as submitted.' },
            { badge: 'amended', variant: 'blue' as const, icon: <PencilLine size={24} />, desc: 'The committee incorporated your view with modifications or partial adoption.' },
            { badge: 'rejected with reasons', variant: 'red' as const, icon: <XCircle size={24} />, desc: 'The committee addressed but did not adopt the view, with explicitly stated reasons.' },
            { badge: 'not addressed', variant: 'gray' as const, icon: <MinusCircle size={24} />, desc: 'The committee report does not show explicit treatment of this specific submission.' },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.48, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card sx={{ p: 0, height: '100%' }}>
                <Box sx={{ p: { xs: 4, md: 5 }, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 260 }}>
                  <Box
                    sx={{
                      width: 60,
                      height: 60,
                      mb: 3,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      color: item.variant === 'green' ? '#047857' : item.variant === 'yellow' ? '#B45309' : item.variant === 'red' ? '#B91C1C' : item.variant === 'blue' ? '#1D4ED8' : '#475569',
                      background: item.variant === 'green' ? '#D1FAE5' : item.variant === 'yellow' ? '#FEF3C7' : item.variant === 'red' ? '#FEE2E2' : item.variant === 'blue' ? '#DBEAFE' : '#F1F5F9',
                      border: '4px solid #fff',
                      boxShadow: '0 6px 18px rgba(15,23,42,.10), inset 0 0 0 1px rgba(15,23,42,.05)',
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Box sx={{ mb: 2, minHeight: 34, display: 'flex', alignItems: 'flex-start' }}>
                    <Badge variant={item.variant} showIcon sx={{ fontSize: 10, py: 0.35, height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.25, display: 'block', py: 0.6 } }}>
                      {item.badge}
                    </Badge>
                  </Box>
                  <Typography
                    sx={{ fontSize: 13, lineHeight: 1.75, color: ink[600], fontWeight: 500 }}
                  >
                    {item.desc}
                  </Typography>
                </Box>
              </Card>
            </motion.div>
          ))}
        </Box>
      </Box>

      {/* ============== INDEPENDENCE ============== */}
      <Box component="section">
        <InfoBox>
          <Box sx={{ pl: 4, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 5, alignItems: 'flex-start', p: { xs: 4, md: 6 } }}>
            <Avatar
              sx={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: 4,
                background: `linear-gradient(135deg, ${palPrimary[500]}, ${palPrimary[700]})`,
                boxShadow: `0 16px 36px -8px ${alpha(palPrimary[500], 0.48)}`,
              }}
              variant="square"
            >
              <Shield size={28} style={{ color: '#fff' }} />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography
                sx={{
                  fontSize: { xs: 24, md: 30 },
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  color: palPrimary[900],
                  mb: 3,
                }}
              >
                Adoption-Independent Accountability
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: 14.5, md: 16 },
                  lineHeight: 1.8,
                  color: alpha(palPrimary[900], 0.92),
                  fontWeight: 500,
                }}
              >
                This platform's accountability evidence comes from institution-published committee reports —{' '}
                <Typography
                  component="span"
                  sx={{
                    fontWeight: 700,
                    background: alpha('#fff', 0.78),
                    px: 1,
                    py: 0.3,
                    borderRadius: 1.5,
                  }}
                >
                  not from representatives choosing to engage
                </Typography>
                . Everything works even when no representative ever registers. Non-response is shown as a neutral, observable status
                derived directly from the committee report itself.
              </Typography>
            </Box>
          </Box>
        </InfoBox>
      </Box>

      {/* ============== PILOT SCOPE ============== */}
      <Box component="section" sx={{ position: 'relative' }}>
        <Box sx={{ maxWidth: 900, mx: 'auto', mb: 10 }}>
          <SectionHeader
            eyebrow="Pilot Scope"
            title="Where we're running first"
            subtitle="We're piloting across three tiers of Kenyan legislature to refine and prove the model."
          />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: { xs: 3, md: 5 },
          }}
        >
          {[
            { name: 'National Assembly', icon: <Globe2 size={22} />, tone: 'primary' as const, desc: 'Legislative tracking: national and unbounded. Citizen activity: confined to pilot counties.' },
            { name: 'Nairobi County', icon: <Users size={22} />, tone: 'accent' as const, desc: 'Testing limited to 2 constituencies. Submissions, receipts, and outcome viewing live.' },
            { name: 'Trans Nzoia County', icon: <BarChart3 size={22} />, tone: 'warm' as const, desc: 'Testing limited to 3 wards. Submissions, receipts, and outcome viewing live.' },
          ].map((scope, i) => {
            const tone = tonePalette[scope.tone];
            const radial =
              scope.tone === 'primary' ? alpha('#6366F1', 0.09) :
              scope.tone === 'accent' ? alpha('#14B8A6', 0.09) :
              alpha('#D97706', 0.09);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.52, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              >
                <Card sx={{ p: 0, height: '100%', position: 'relative', overflow: 'hidden' }}>
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.55,
                      pointerEvents: 'none',
                      background: `radial-gradient(circle at 0% 0%, ${radial}, transparent 58%)`,
                    }}
                  />
                  <Box sx={{ p: { xs: 5, md: 6 }, position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Avatar
                      sx={{
                        width: 68,
                        height: 68,
                        borderRadius: '50%',
                        background: tone.iconBg,
                        color: '#fff',
                        boxShadow: tone.shadow,
                        mb: 3,
                        alignSelf: 'center',
                        flexShrink: 0,
                        border: '4px solid #fff',
                        outline: `1px solid ${alpha(tone.glow, 0.25)}`,
                        boxSizing: 'content-box',
                      }}
                    >
                      {scope.icon}
                    </Avatar>
                    <Typography
                      sx={{
                        fontSize: 22,
                        fontWeight: 900,
                        letterSpacing: '-0.018em',
                        color: ink[900],
                        mb: 2,
                        textAlign: 'center',
                      }}
                    >
                      {scope.name}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 14,
                        lineHeight: 1.75,
                        color: ink[600],
                        fontWeight: 500,
                        flex: 1,
                        mb: 3,
                        textAlign: 'center',
                      }}
                    >
                      {scope.desc}
                    </Typography>
                    <Box
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1.25,
                        fontSize: 14,
                        fontWeight: 800,
                        color: palPrimary[700],
                        alignSelf: 'center',
                        '& .arrow': { transition: 'transform 260ms ease' },
                        '&:hover .arrow': { transform: 'translateX(4px)' },
                      }}
                    >
                      <span>Learn more</span>
                      <ArrowRight size={15} className="arrow" />
                    </Box>
                  </Box>
                </Card>
              </motion.div>
            );
          })}
        </Box>
      </Box>

      {/* ============== FINAL CTA ============== */}
      <Box component="section" sx={{ position: 'relative' }}>
        <Card
          sx={{
            p: 0,
            position: 'relative',
            overflow: 'hidden',
            border: 'none',
            borderRadius: '24px',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(135deg, ${palPrimary[600]} 0%, ${palPrimary[700]} 50%, ${palSecondary[600]} 100%)`,
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              opacity: 0.22,
              backgroundImage:
                'radial-gradient(circle at 3px 3px, rgba(255,255,255,0.9) 1px, transparent 0)',
              backgroundSize: '32px 32px',
              maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 78%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 78%)',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: -120,
              left: -120,
              width: 320,
              height: 320,
              borderRadius: '50%',
              background: alpha('#fff', 0.12),
              filter: 'blur(80px)',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              bottom: -140,
              right: -140,
              width: 380,
              height: 380,
              borderRadius: '50%',
              background: alpha(palSecondary[400], 0.24),
              filter: 'blur(90px)',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: '30%',
              right: '15%',
              width: 200,
              height: 200,
              borderRadius: '50%',
              border: `1px dashed ${alpha('#fff', 0.18)}`,
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              bottom: '20%',
              left: '10%',
              width: 120,
              height: 120,
              borderRadius: 4,
              border: `1px dashed ${alpha('#fff', 0.15)}`,
              transform: 'rotate(-8deg)',
            }}
          />

          <Box sx={{ position: 'relative', p: { xs: 6, md: 12 }, textAlign: 'center' }}>
            <Badge
              variant="accent"
              sx={{
                background: alpha('#fff', 0.14),
                color: '#fff',
                border: `1px solid ${alpha('#fff', 0.32)}`,
                backdropFilter: 'blur(10px)',
                mb: 6,
                fontSize: 11,
              }}
            >
              <Sparkles size={12} /> Ready to participate
            </Badge>
            <Typography
              sx={{
                fontSize: { xs: 32, md: 50, lg: 58 },
                fontWeight: 900,
                letterSpacing: '-0.03em',
                color: '#fff',
                mb: 5,
                lineHeight: 1.05,
              }}
            >
              Your voice deserves a receipt.
            </Typography>
            <Typography
              sx={{
                fontSize: { xs: 16, md: 20 },
                color: alpha('#fff', 0.88),
                maxWidth: 720,
                mx: 'auto',
                mb: 10,
                lineHeight: 1.8,
                fontWeight: 500,
              }}
            >
              Participate in Kenya's legislative process with confidence. Every submission — every step — is on the record.
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: { xs: 2.5, md: 3.5 },
              }}
            >
              <Box
                component={Link}
                to="/submit"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.35,
                  px: { xs: 5.5, md: 8 },
                  py: { xs: 2, md: 2.4 },
                  borderRadius: 4.5,
                  fontSize: { xs: 15, md: 17 },
                  fontWeight: 800,
                  color: palPrimary[700],
                  textDecoration: 'none',
                  background: '#fff',
                  boxShadow: `0 28px 60px -14px ${alpha('#000', 0.28)}, 0 6px 16px -6px ${alpha('#000', 0.18)}`,
                  transition: 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 36px 72px -16px ${alpha('#000', 0.34)}, 0 8px 20px -8px ${alpha('#000', 0.22)}`,
                    color: palPrimary[800],
                  },
                  '&:active': { transform: 'translateY(-0.5px)' },
                }}
              >
                <Send size={18} /> Submit Your View Now
              </Box>

              <Box
                component={Link}
                to="/bills"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.35,
                  px: { xs: 5.5, md: 8 },
                  py: { xs: 2, md: 2.4 },
                  borderRadius: 4.5,
                  fontSize: { xs: 15, md: 17 },
                  fontWeight: 700,
                  color: '#fff',
                  textDecoration: 'none',
                  background: alpha('#fff', 0.12),
                  backdropFilter: 'blur(14px)',
                  border: `1px solid ${alpha('#fff', 0.3)}`,
                  transition: 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '&:hover': {
                    background: alpha('#fff', 0.22),
                    transform: 'translateY(-2px)',
                  },
                  '&:active': { transform: 'translateY(-0.5px)' },
                }}
              >
                <Gavel size={18} /> Browse Tracked Bills
              </Box>
            </Box>
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
