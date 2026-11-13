import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AppBar,
  Toolbar,
  Box,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Divider,
  Typography,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Menu as MenuIcon,
  X as XIcon,
  Shield,
  LogIn,
  LogOut,
  WifiOff,
  Scale,
  Gavel,
  Home,
  FileSearch,
  Link2,
  Users,
  BookOpen,
  MessageSquarePlus,
  Receipt,
  LayoutDashboard,
  UserCheck,
  ClipboardList,
  Flag,
  FileUp,
  FolderOpen,
  Settings2,
  Database,
  Heart,
} from 'lucide-react';

const SIDEBAR_WIDTH = 280;

type NavLink = { to: string; label: string; icon: any };

const publicLinks: NavLink[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/bills', label: 'Bills', icon: Gavel },
  { to: '/receipt-lookup', label: 'Track a Submission', icon: FileSearch },
  { to: '/receipt-verify', label: 'Verify Hash Chain', icon: Link2 },
  { to: '/community-rules', label: 'Community Rules', icon: BookOpen },
  { to: '/research/export', label: 'Public Data', icon: Database },
];

const publicLinksByRole: Record<string, NavLink[]> = {
  // Citizens track their own views under My Submissions instead. Community rules
  // and public data stay in the visitor menu only.
  citizen: publicLinks.filter(link => !['/receipt-lookup', '/community-rules', '/research/export'].includes(link.to)),
  // Officers need to see the public bill record, but not public verification
  // and research tools that are unrelated to their operational workspace.
  committee_officer: publicLinks.filter(link => ['/','/bills'].includes(link.to)),
  reviewer: publicLinks.filter(link => ['/','/bills','/receipt-lookup'].includes(link.to)),
  moderator: publicLinks.filter(link => ['/','/bills','/receipt-lookup'].includes(link.to)),
  administrator: publicLinks.filter(link => ['/','/bills'].includes(link.to)),
};

const authenticatedLinksMap: Record<string, NavLink[]> = {
  citizen: [
    { to: '/my-receipts', label: 'My Submissions', icon: Receipt },
    { to: '/messages', label: 'Updates', icon: MessageSquarePlus },
  ],
  reviewer: [
    { to: '/reviewer/queue', label: 'Match Review', icon: ClipboardList },
    { to: '/reviewer/reports', label: 'Reported Content', icon: Flag },
  ],
  moderator: [
    { to: '/reviewer/queue', label: 'Match Review', icon: ClipboardList },
    { to: '/reviewer/reports', label: 'Reported Content', icon: Flag },
  ],
  committee_officer: [
    { to: '/committee', label: 'Bill Ingestion', icon: Database },
    { to: '/committee/ingestion', label: 'Upload a Report', icon: FileUp },
    { to: '/committee/notices', label: 'Calls for Views', icon: FolderOpen },
  ],
  administrator: [
    { to: '/admin', label: 'Administration', icon: Settings2 },
  ],
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const theme = useTheme();
  const ink = theme.palette.ink as any;
  const palPrimary = theme.palette.primary as any;
  const palSecondary = theme.palette.secondary as any;
  const palSaffron = (theme.palette.saffron || theme.palette.warning) as any;
  const displayUserName = state.currentUser?.name === 'Independent Reviewer' ? 'Moderator' : state.currentUser?.name;
  const roleLabel = !state.currentUser
    ? ''
    : state.currentUser.role === 'reviewer'
      ? 'Moderator'
      : state.currentUser.role === 'committee_officer'
        ? 'Clerk’s Office / Committee Secretariat'
        : state.currentUser.role.replace(/_/g, ' ');

  const currentRoleLinks = state.currentUser
    ? authenticatedLinksMap[state.currentUser.role] || []
    : [];

  const visiblePublicLinks = state.currentUser
    ? publicLinksByRole[state.currentUser.role] || []
    : publicLinks;

  const closeMobileMenu = () => setMobileMenuOpen(false);
  // Visitors on the home page get no menu: the home page itself is the way in.
  const bareHome = !state.currentUser && location.pathname === '/';

  const signOut = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('current_user');
    dispatch({ type: 'SET_USER', payload: null });
    closeMobileMenu();
  };

  const sectionHeadingSx = {
    color: ink[500],
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
  } as const;

  const brand = (
    <Box
      component={Link}
      to="/"
      onClick={closeMobileMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        textDecoration: 'none',
        color: 'inherit',
        minWidth: 0,
      }}
    >
      <Box sx={{ position: 'relative', width: 46, height: 46, flexShrink: 0 }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(135deg, ${palPrimary[500]}, ${palSecondary[500]})`,
            borderRadius: 3,
            filter: 'blur(8px)',
            opacity: 0.4,
            transition: 'opacity 420ms ease',
            '&:hover': { opacity: 0.75 },
          }}
        />
        <Box
          sx={{
            position: 'relative',
            width: 46,
            height: 46,
            borderRadius: 3,
            background: `linear-gradient(135deg, ${palPrimary[600]} 0%, ${palPrimary[500]} 50%, ${palSecondary[500]} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 10px 24px -8px ${alpha(palPrimary[500], 0.45)}`,
          }}
        >
          <Scale size={24} strokeWidth={2.25} style={{ color: '#fff' }} />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', color: ink[900] }}>
          Participation Trace
        </Typography>
        <Typography
          sx={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: ink[500],
            mt: 0.5,
          }}
        >
          Kenya
        </Typography>
      </Box>
    </Box>
  );

  const signInButton = (
    <Box
      component={Link}
      to="/login"
      onClick={closeMobileMenu}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.25,
        px: 3,
        py: 1.4,
        borderRadius: 3.5,
        fontSize: 13,
        fontWeight: 700,
        color: '#fff',
        textDecoration: 'none',
        background: `linear-gradient(135deg, ${palPrimary[600]} 0%, ${palPrimary[500]} 45%, ${palSecondary[600]} 100%)`,
        backgroundSize: '200% 200%',
        backgroundPosition: '0% 50%',
        boxShadow: `0 6px 18px -4px ${alpha(palPrimary[500], 0.45)}, inset 0 1px 0 ${alpha('#fff', 0.18)}`,
        transition: 'all 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        '&:hover': {
          backgroundPosition: '100% 50%',
          transform: 'translateY(-1px)',
          boxShadow: `0 14px 30px -8px ${alpha(palPrimary[500], 0.58)}, inset 0 1px 0 ${alpha('#fff', 0.22)}`,
        },
        '&:active': { transform: 'translateY(0)' },
      }}
    >
      <LogIn size={15} /> Sign In
    </Box>
  );

  const renderNavList = (links: NavLink[]) => (
    <List sx={{ pt: 0.5 }}>
      {links.map((link) => {
        const Icon = link.icon;
        const active = location.pathname === link.to;
        return (
          <ListItemButton
            key={link.to}
            component={Link as any}
            to={link.to}
            selected={active}
            aria-current={active ? 'page' : undefined}
            onClick={closeMobileMenu}
            sx={{
              borderRadius: 3, px: 1.5, py: 1.1, gap: 1.5, mb: 0.5,
              color: ink[700], transition: 'all 180ms ease',
              '&:hover': { background: alpha(palPrimary[500], 0.07), transform: 'translateX(2px)' },
              '&.Mui-selected': { color: palPrimary[700], background: `linear-gradient(135deg, ${alpha(palPrimary[500], 0.12)}, ${alpha(palSecondary[500], 0.08)})` },
              '&.Mui-selected:hover': { background: alpha(palPrimary[500], 0.16) },
            }}
          >
            <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}>
              <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 2.5, background: active ? alpha(palPrimary[500], 0.12) : alpha('#64748B', 0.08), color: active ? palPrimary[700] : ink[500] }}>
                <Icon size={17} strokeWidth={2.1} />
              </Box>
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{link.label}</Typography>
              }
            />
          </ListItemButton>
        );
      })}
    </List>
  );

  const renderSidebar = (inDrawer: boolean) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {brand}
        {inDrawer && (
          <IconButton onClick={closeMobileMenu} sx={{ borderRadius: 3 }} aria-label="Close menu">
            <XIcon size={20} />
          </IconButton>
        )}
      </Box>

      <Divider sx={{ mx: 2.5 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 2 }}>
        <Typography sx={{ ...sectionHeadingSx, px: 1.5, mb: 0.5 }}>
          Navigation
        </Typography>
        {renderNavList(visiblePublicLinks)}

        {renderNavList(currentRoleLinks)}
      </Box>

      <Divider />

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, px: 1 }}>
          {state.isOnline ? (
            <>
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: palSecondary[400],
                    opacity: 0.75,
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
              <Typography sx={{ fontWeight: 700, fontSize: 11, color: ink[500] }}>Live connection</Typography>
            </>
          ) : (
            <>
              <WifiOff size={14} style={{ color: palSaffron[600] }} />
              <Typography sx={{ fontWeight: 700, fontSize: 11, color: palSaffron[700] }}>Working offline</Typography>
            </>
          )}
        </Box>

        {state.currentUser ? (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 4,
              background: `linear-gradient(135deg, ${alpha(palPrimary[500], 0.10)}, ${alpha(palSecondary[500], 0.08)})`,
              border: `1px solid ${alpha(palPrimary[500], 0.14)}`,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <Avatar sx={{ width: 40, height: 40, fontSize: 14, flexShrink: 0 }}>
              {displayUserName?.charAt(0)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontWeight: 800, fontSize: 14, color: ink[800] }}>
                {displayUserName}
              </Typography>
              <Typography
                sx={{
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: palPrimary[600],
                  fontSize: 9.5,
                  lineHeight: 1.3,
                }}
              >
                {roleLabel}
              </Typography>
            </Box>
            <Tooltip title="Sign out" placement="top" arrow>
              <IconButton
                size="small"
                onClick={signOut}
                aria-label="Sign out"
                sx={{
                  '&:hover': {
                    background: alpha('#DC2626', 0.08),
                    color: '#DC2626',
                  },
                }}
              >
                <LogOut size={17} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <>
            {signInButton}
            <Box
              component={Link}
              to="/signup"
              onClick={closeMobileMenu}
              sx={{
                display: 'inline-flex',
                justifyContent: 'center',
                px: 1.5,
                py: 1,
                borderRadius: 2.5,
                color: palPrimary[700],
                fontSize: 12,
                fontWeight: 800,
                textDecoration: 'none',
                '&:hover': { background: alpha(palPrimary[500], 0.08) },
              }}
            >
              Sign Up
            </Box>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      component="div"
      sx={{
        minHeight: '100vh',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      <Box
        className="hero-blob animate-float-slow"
        sx={{
          width: 560,
          height: 560,
          top: -180,
          right: -140,
          background: `radial-gradient(circle, ${palPrimary.main}, transparent 70%)`,
          opacity: 0.16,
        }}
      />
      <Box
        className="hero-blob animate-float-slow"
        sx={{
          width: 500,
          height: 500,
          top: 240,
          left: -180,
          background: `radial-gradient(circle, ${palSecondary.main}, transparent 70%)`,
          opacity: 0.13,
          animationDelay: '2.2s',
        }}
      />
      <Box
        className="hero-blob animate-float-slow"
        sx={{
          width: 380,
          height: 380,
          top: 600,
          right: '35%',
          background: `radial-gradient(circle, ${palSaffron.main}, transparent 70%)`,
          opacity: 0.09,
          animationDelay: '4.4s',
        }}
      />

      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary-700 focus:text-white focus:px-4 focus:py-2 focus:rounded-2xl focus:shadow-[0_20px_40px_-10px_rgba(79,70,229,0.6)]">
        Skip to main content
      </a>

      <Box
        component="nav"
        aria-label="Primary navigation"
        sx={{
          display: { xs: 'none', md: bareHome ? 'none' : 'block' },
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH,
          zIndex: (t) => t.zIndex.appBar + 1,
          background: alpha('#fff', 0.96),
          backdropFilter: 'blur(18px)',
          borderRight: '1px solid #e2ded5',
          boxShadow: '6px 0 24px -12px rgba(24,32,32,.18)',
        }}
      >
        {renderSidebar(false)}
      </Box>

      <AppBar
        position="sticky"
        className="app-header-glass"
        sx={{ display: { xs: 'flex', md: bareHome ? 'flex' : 'none' }, zIndex: (t) => t.zIndex.appBar + 1 }}
      >
        <Toolbar sx={{ width: '100%', gap: 1.5, maxWidth: bareHome ? 1280 : undefined, mx: 'auto' }}>
          {brand}
          <Box sx={{ flexGrow: 1 }} />
          {bareHome && (
            <Box component={Link} to="/signup" sx={{ display: { xs: 'none', sm: 'inline-flex' }, px: 1.5, py: 1, borderRadius: 2.5, color: palPrimary[700], fontSize: 13, fontWeight: 800, textDecoration: 'none', '&:hover': { background: alpha(palPrimary[500], 0.08) } }}>
              Sign Up
            </Box>
          )}
          {!state.currentUser && (
            <Box sx={{ display: { xs: bareHome ? 'block' : 'none', sm: 'block' } }}>{signInButton}</Box>
          )}
          {!bareHome && <IconButton
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-controls="primary-navigation-drawer"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            sx={{
              borderRadius: 3,
              p: 1.25,
              color: ink[800],
              border: `1px solid ${alpha('#E2E8F0', 0.9)}`,
              background: alpha('#fff', 0.7),
              transition: 'all 180ms ease',
              '&:hover': { background: alpha(palPrimary[500], 0.08), color: palPrimary[700] },
            }}
          >
            {mobileMenuOpen ? <XIcon size={20} strokeWidth={2.2} /> : <MenuIcon size={20} strokeWidth={2.2} />}
          </IconButton>}
        </Toolbar>
      </AppBar>

      <Drawer
        id="primary-navigation-drawer"
        anchor="left"
        open={mobileMenuOpen && !bareHome}
        onClose={closeMobileMenu}
        sx={{ display: { md: 'none' } }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '86%', sm: SIDEBAR_WIDTH },
              maxWidth: '100vw',
              background: `linear-gradient(180deg, ${alpha('#fff', 0.98)} 0%, ${alpha('#F8FAFC', 0.95)} 100%)`,
              backdropFilter: 'blur(26px) saturate(1.2)',
              borderRight: `1px solid ${alpha('#fff', 0.6)}`,
              borderTopRightRadius: 20,
              borderBottomRightRadius: 20,
              boxShadow: `0 48px 96px -16px ${alpha('#0F172A', 0.22)}`,
            },
          },
        }}
      >
        {renderSidebar(true)}
      </Drawer>

      <Box
        sx={{
          ml: { md: bareHome ? 0 : `${SIDEBAR_WIDTH}px` },
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
      <Box className="kenya-flag" role="img" aria-label="Flag of Kenya">
        <img src="/kenya-flag-shield.svg" alt="" aria-hidden="true" />
      </Box>

      <AnimatePresence>
        {!state.isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="offline-banner"
          >
            <Box
              sx={{
                maxWidth: 1280,
                mx: 'auto',
                width: '100%',
                px: { xs: 2, sm: 3, lg: 4 },
                py: 2.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
              }}
            >
              <WifiOff size={17} style={{ color: '#92400E' }} />
              <Typography
                sx={{
                  fontWeight: 600,
                  color: '#78350F',
                  textAlign: 'center',
                  fontSize: 14,
                }}
              >
                You are offline.{' '}
                <Typography component="span" sx={{ fontWeight: 500, color: '#92400E', fontSize: 14 }}>
                  Drafts are saved on this device and will be sent when you reconnect.
                </Typography>
              </Typography>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>

      <Box
        component="main"
        id="main-content"
        sx={{
          flex: 1,
          position: 'relative',
          zIndex: 1,
          width: '100%',
        }}
      >
        <Box
          sx={{
            maxWidth: 1280,
            mx: 'auto',
            width: '100%',
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 4, md: 5, lg: 6 },
          }}
        >
          {/* A keyed fade-in only. The previous exit animation (AnimatePresence
              mode="wait") rendered each new page twice, so typing in its first
              moments was lost. */}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </Box>
      </Box>

      <Box
        component="footer"
        sx={{
          position: 'relative',
          mt: 'auto',
          borderTop: `1px solid ${alpha('#F1E0C7', 0.85)}`,
          overflow: 'hidden',
          isolation: 'isolate',
        }}
      >
        <Box
          className="kitenge-grid"
          sx={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            background: `linear-gradient(180deg, transparent 0%, ${alpha('#FFFBF5', 0.72)} 50%, ${alpha('#FEF7ED', 0.96)} 100%)`,
          }}
        />
        <Box
          className="footer-blob-a"
          sx={{
            width: 560,
            height: 560,
            bottom: -220,
            right: -220,
            background: `radial-gradient(circle, ${palPrimary[300]}, transparent 65%)`,
            opacity: 0.35,
          }}
        />
        <Box
          className="footer-blob-b"
          sx={{
            width: 520,
            height: 520,
            top: -220,
            left: -220,
            background: `radial-gradient(circle, ${palSecondary[300]}, transparent 65%)`,
            opacity: 0.28,
          }}
        />

        <Box
          sx={{
            position: 'relative',
            maxWidth: 1280,
            mx: 'auto',
            width: '100%',
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 3, md: 4 },
            zIndex: 1,
          }}
        >
          <Box
            className="masai-border-left kenya-corner"
            sx={{
              mb: 3,
              p: { xs: 2, md: 2.5 },
              borderRadius: '16px',
              background: `linear-gradient(135deg, ${alpha('#FEF3C7', 0.62)} 0%, ${alpha('#FFEDD5', 0.58)} 100%)`,
              border: `1px solid ${alpha('#CA8A04', 0.30)}`,
              color: '#713F12',
              boxShadow: `inset 0 1px 0 ${alpha('#fff', 0.6)}`,
              maxWidth: 900,
              mx: 'auto',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                opacity: 0.35,
              }}
              className="sunburst"
            />
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, position: 'relative', zIndex: 1 }}>
              <Shield size={22} style={{ color: '#991B1B', flexShrink: 0, marginTop: 2 }} />
              <Typography sx={{ fontWeight: 500, lineHeight: 1.75, fontSize: 14 }}>
                <Typography component="strong" sx={{ fontWeight: 800, color: '#991B1B' }}>
                  Participation Trace Disclaimer:
                </Typography>{' '}
                These are platform activity labels only. They are not legal findings, electoral judgments, or allegations of corruption.
                Non-response by an office is shown as a neutral, observable status derived from the committee report itself.
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: { xs: 2, md: 3, xl: 4 },
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'minmax(0, 5fr) minmax(0, 3fr) minmax(0, 4fr)' },
              mb: 3,
            }}
          >
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '11px',
                    background: `linear-gradient(135deg, ${palPrimary[600]} 0%, ${palPrimary[500]} 50%, ${palSecondary[500]} 100%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: `0 10px 24px -8px ${alpha(palPrimary[500], 0.38)}`,
                  }}
                >
                  <Scale size={22} strokeWidth={2.25} style={{ color: '#fff' }} />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 800, letterSpacing: '-0.01em', fontSize: 15 }}>
                    Participation Trace
                  </Typography>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: ink[500] }}>
                    Kenya · 2026
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ color: ink[600], lineHeight: 1.65, mb: 2, maxWidth: 460, fontWeight: 500, fontSize: 13.5 }}>
                Submission-to-Decision Traceability Platform for Kenya's legislatures. Working with the National Assembly,
                Nairobi & Trans Nzoia County Assemblies.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Heart size={15} fill="#FDA4AF" style={{ color: '#FB7185' }} />
                <Typography sx={{ fontWeight: 600, color: ink[500], fontSize: 12 }}>
                  Built for accountable participation
                </Typography>
              </Box>
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, mb: 2, letterSpacing: '-0.01em', fontSize: 15 }}>
                Key Limitations
              </Typography>
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[
                  'Cannot force a representative to engage',
                  'No guarantee a concern is resolved',
                  'Online submissions ≠ statistical representation',
                  'Does not provide legal advice',
                ].map((item, i) => (
                  <Box component="li" key={i} sx={{ display: 'flex', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 5,
                        height: 5,
                        mt: 1.7,
                        flexShrink: 0,
                        borderRadius: '50%',
                        background: `linear-gradient(135deg, ${palPrimary[400]}, ${palSecondary[400]})`,
                      }}
                    />
                    <Typography sx={{ color: ink[600], fontWeight: 500, lineHeight: 1.6, fontSize: 14 }}>
                      {item}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, mb: 2, letterSpacing: '-0.01em', fontSize: 15 }}>
                Legal Context
              </Typography>
              <Typography sx={{ color: ink[600], lineHeight: 1.65, mb: 1.5, fontSize: 14, fontWeight: 500 }}>
                Kenyan courts test public participation as{' '}
                <Typography
                  component="span"
                  sx={{
                    fontWeight: 700,
                    color: ink[800],
                    background: alpha(palPrimary[500], 0.07),
                    px: 1,
                    py: 0.3,
                    borderRadius: 1.5,
                  }}
                >
                  "reasonable, meaningful, and effective"
                </Typography>
                .
              </Typography>
              <Typography sx={{ color: ink[500], lineHeight: 1.75, fontSize: 12.5 }}>
                Constitution of Kenya 2010, Articles 10(2)(a), 118(1)(b), and 196 form the legal backdrop for the standards
                this platform helps evidence.
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ borderColor: alpha('#F1E0C7', 0.95) }} />

          <Box
            sx={{
              pt: 1.5,
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              alignItems: { xs: 'flex-start', sm: 'center' },
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Typography sx={{ fontWeight: 600, color: ink[500], fontSize: 12 }}>
              English only · Data is sourced from official syncs
            </Typography>
            <Typography sx={{ color: ink[400], fontSize: 12 }}>
              © 2026 Participation Traceability Platform
            </Typography>
          </Box>
        </Box>
      </Box>
      </Box>
    </Box>
  );
}
