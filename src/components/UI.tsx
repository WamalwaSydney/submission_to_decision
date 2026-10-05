import React from 'react';
import {
  Card as MuiCard,
  CardContent,
  Button,
  Chip as MuiChip,
  TextField,
  InputLabel,
  Alert,
  Box,
  Typography,
  Avatar,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Sparkles,
} from 'lucide-react';

// ============ BUTTONS ============
type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface BtnProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variantStyle?: ButtonVariant;
  sx?: any;
}

const gradientBg = (v: ButtonVariant) => {
  if (v === 'danger') return 'linear-gradient(135deg, #A52D29 0%, #83211E 100%)';
  return 'linear-gradient(135deg, #A52D29 0%, #C98B18 52%, #176B2B 100%)';
};

const shadow = (v: ButtonVariant, hover: boolean) => {
  const color = v === 'danger' ? '#A52D29' : '#176B2B';
  return hover
    ? `0 14px 30px -8px ${alpha(color, 0.58)}, inset 0 1px 0 ${alpha('#fff', 0.22)}`
    : `0 6px 18px -4px ${alpha(color, 0.44)}, inset 0 1px 0 ${alpha('#fff', 0.18)}`;
};

function BaseButton({ variantStyle = 'primary', className = '', children, sx, ...rest }: BtnProps) {
  const isSecondary = variantStyle === 'secondary';
  return (
    <Button
      disableElevation
      component="button"
      {...(rest as any)}
      className={className}
      sx={(t) => {
        const ink = (t.palette as any).ink;
        return {
          borderRadius: 3.5,
          px: 3,
          py: 1.5,
          fontSize: 14,
          fontWeight: 700,
          textTransform: 'none',
          letterSpacing: '-0.01em',
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 280ms cubic-bezier(0.22, 1, 0.36, 1)',
          ...(isSecondary
            ? {
                color: ink?.[700] || '#334155',
                background: alpha('#fff', 0.82),
                backdropFilter: 'blur(10px)',
                border: `1px solid ${alpha('#E2E8F0', 0.9)}`,
                '&:hover': {
                  background: '#fff',
                  borderColor: alpha('#A52D29', 0.28),
                  color: '#83211E',
                  transform: 'translateY(-1px)',
                  boxShadow: `0 14px 30px -10px ${alpha('#0F172A', 0.14)}, 0 4px 10px -3px ${alpha('#0F172A', 0.06)}`,
                },
                '&:active': { transform: 'translateY(0)' },
              }
            : {
                color: '#fff',
                background: gradientBg(variantStyle),
                backgroundSize: '200% 200%',
                backgroundPosition: '0% 50%',
                boxShadow: shadow(variantStyle, false),
                '&:hover': {
                  backgroundPosition: '100% 50%',
                  transform: 'translateY(-1px)',
                  boxShadow: shadow(variantStyle, true),
                },
                '&:active': { transform: 'translateY(0)', boxShadow: shadow(variantStyle, false) },
              }),
          ...(sx as any),
        };
      }}
    >
      {children}
    </Button>
  );
}

export function BtnPrimary({ children, className = '', disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <BaseButton variantStyle="primary" className={className} disabled={disabled} {...props}>
      {children}
    </BaseButton>
  );
}

export function BtnSecondary({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <BaseButton variantStyle="secondary" className={className} {...props}>
      {children}
    </BaseButton>
  );
}

export function BtnDanger({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <BaseButton variantStyle="danger" className={className} {...props}>
      {children}
    </BaseButton>
  );
}

// ============ CARDS ============
export function Card({
  children,
  className = '',
  hover = true,
  sx,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  sx?: any;
}) {
  return (
    <MuiCard
      variant="outlined"
      className={className}
      sx={(t) => {
        const base: any = {
          p: 0,
          width: '100%',
          minWidth: 0,
          borderRadius: `${Number((t.shape as any).card) || 18}px`,
          background: '#FFFFFF',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'blur(14px)',
          border: `1px solid ${alpha('#E2DED5', 0.95)}`,
          boxShadow: `0 2px 8px -2px ${alpha('#0F172A', 0.06)}, 0 1px 4px -2px ${alpha('#0F172A', 0.04)}, inset 0 1px 0 ${alpha('#fff', 0.9)}`,
          transition: 'all 380ms cubic-bezier(0.22, 1, 0.36, 1)',
        };
        if (hover) {
          base['&:hover'] = {
            boxShadow: `0 20px 40px -10px ${alpha('#0F172A', 0.14)}, 0 6px 14px -6px ${alpha('#0F172A', 0.07)}, inset 0 1px 0 ${alpha('#fff', 1)}`,
            transform: 'translateY(-3px)',
            borderColor: alpha('#A52D29', 0.22),
          };
        }
        return { ...base, ...(sx as any) };
      }}
    >
      <CardContent sx={{ p: 0 }}>{children}</CardContent>
    </MuiCard>
  );
}

export function CardGlass({ children, className = '', sx }: { children: React.ReactNode; className?: string; sx?: any }) {
  return (
    <MuiCard
      variant="outlined"
      className={className}
      sx={{
        p: 0,
        width: '100%',
        minWidth: 0,
        borderRadius: '18px',
        background: `linear-gradient(135deg, ${alpha('#fff', 0.72)} 0%, ${alpha('#fff', 0.5)} 100%)`,
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        border: `1px solid ${alpha('#fff', 0.6)}`,
        boxShadow: `0 4px 14px -4px ${alpha('#0F172A', 0.08)}`,
        ...(sx as any),
      }}
    >
      <CardContent sx={{ p: 0 }}>{children}</CardContent>
    </MuiCard>
  );
}

// ============ BADGES ============
export type BadgeVariant = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'accent' | 'warm';

const badgeIcons: Record<string, React.ReactElement> = {
  green: <CheckCircle2 size={13} />,
  yellow: <AlertTriangle size={13} />,
  red: <XCircle size={13} />,
  blue: <Info size={13} />,
  accent: <Sparkles size={13} />,
  warm: <AlertTriangle size={13} />,
};

const variantToColor: Record<BadgeVariant, { bg: string; border: string; text: string }> = {
  green: {
    bg: `linear-gradient(135deg, ${alpha('#10B981', 0.18)}, ${alpha('#059669', 0.12)})`,
    border: alpha('#10B981', 0.32),
    text: '#065F46',
  },
  yellow: {
    bg: `linear-gradient(135deg, ${alpha('#F59E0B', 0.22)}, ${alpha('#D97706', 0.14)})`,
    border: alpha('#F59E0B', 0.36),
    text: '#92400E',
  },
  red: {
    bg: `linear-gradient(135deg, ${alpha('#EF4444', 0.18)}, ${alpha('#DC2626', 0.12)})`,
    border: alpha('#EF4444', 0.32),
    text: '#991B1B',
  },
  blue: {
    bg: `linear-gradient(135deg, ${alpha('#3B82F6', 0.18)}, ${alpha('#2563EB', 0.12)})`,
    border: alpha('#3B82F6', 0.32),
    text: '#1E3A8A',
  },
  gray: {
    bg: `linear-gradient(135deg, ${alpha('#F1F5F9', 1)}, ${alpha('#E2E8F0', 0.65)})`,
    border: alpha('#CBD5E1', 0.85),
    text: '#334155',
  },
  accent: {
    bg: `linear-gradient(135deg, ${alpha('#2DD4BF', 0.18)}, ${alpha('#0D9488', 0.12)})`,
    border: alpha('#2DD4BF', 0.32),
    text: '#115E59',
  },
  warm: {
    bg: `linear-gradient(135deg, ${alpha('#FBBF24', 0.22)}, ${alpha('#D97706', 0.14)})`,
    border: alpha('#FBBF24', 0.36),
    text: '#92400E',
  },
};

export function Badge({
  children,
  variant = 'gray',
  className = '',
  showIcon = false,
  sx,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  showIcon?: boolean;
  sx?: any;
}) {
  const c = variantToColor[variant];
  const chipColorMap: Record<BadgeVariant, any> = {
    green: 'success',
    yellow: 'warning',
    red: 'error',
    blue: 'info',
    gray: 'default',
    accent: 'secondary',
    warm: 'warning',
  };
  const iconEl: React.ReactElement | undefined = showIcon ? (badgeIcons[variant] as React.ReactElement) : undefined;
  return (
    <MuiChip
      color={chipColorMap[variant]}
      className={className}
      icon={iconEl}
      label={children}
      size="small"
      sx={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        fontWeight: 800,
        fontSize: 11,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        borderRadius: 2.5,
        px: 0.5,
        boxShadow: `inset 0 1px 0 ${alpha('#fff', 0.75)}`,
        '& .MuiChip-icon': { color: c.text, ml: 0.8, mr: -0.3 },
        '& .MuiChip-label': { px: 1.2, py: 0.25 },
        ...(sx as any),
      }}
    />
  );
}

// ============ INPUTS ============
export function InputField({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const { label, placeholder, id, type, value, onChange, disabled, required, ...rest } = props as any;
  const shrink = value !== undefined && value !== '' && value !== null ? true : undefined;
  return (
    <TextField
      className={className}
      label={label}
      placeholder={placeholder}
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      disabled={disabled}
      required={required}
      fullWidth
      InputLabelProps={{ shrink }}
      {...(rest as any)}
    />
  );
}

export function TextAreaField({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { label, placeholder, id, value, onChange, disabled, required, rows = 4, ...rest } = props as any;
  const shrink = value !== undefined && value !== '' && value !== null ? true : undefined;
  return (
    <TextField
      className={className}
      label={label}
      placeholder={placeholder}
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      required={required}
      multiline
      minRows={rows}
      fullWidth
      InputLabelProps={{ shrink }}
      sx={{
        '& .MuiOutlinedInput-inputMultiline': { py: 2, lineHeight: 1.7 },
      }}
      {...(rest as any)}
    />
  );
}

export function SelectField({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  const { label, id, value, onChange, disabled, required, ...rest } = props as any;
  const shrink = value !== undefined && value !== '' && value !== null ? true : undefined;
  return (
    <TextField
      className={className}
      label={label}
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      required={required}
      select
      fullWidth
      InputLabelProps={{ shrink }}
      SelectProps={{
        native: true,
        children,
      }}
      {...(rest as any)}
    />
  );
}

export function Label({ children, className = '', ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <InputLabel
      shrink
      className={className}
      sx={{ display: 'block', position: 'static', mb: 1.5 }}
      {...(props as any)}
    >
      {children}
    </InputLabel>
  );
}

// ============ INFO BOXES ============
function InfoBoxBase({
  tone,
  children,
  className = '',
  sx,
}: {
  tone: 'warning' | 'info' | 'success';
  children: React.ReactNode;
  className?: string;
  sx?: any;
}) {
  return (
    <Alert
      severity={tone}
      variant="outlined"
      className={className}
      sx={{
        p: 0,
        borderRadius: '14px',
        '& .MuiAlert-message': { width: '100%', p: 0 },
        '& .MuiAlert-icon': { display: 'none' },
        ...(sx as any),
      }}
    >
      <Box sx={{ pl: 3 }}>{children}</Box>
    </Alert>
  );
}

export function DisclaimerBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <InfoBoxBase tone="warning" className={className}>{children}</InfoBoxBase>;
}

export function InfoBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <InfoBoxBase tone="info" className={className}>{children}</InfoBoxBase>;
}

export function SuccessBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <InfoBoxBase tone="success" className={className}>{children}</InfoBoxBase>;
}

// ============ PREMIUM COMPONENTS ============
const tonePaletteMap = {
  primary: {
    surface: `linear-gradient(135deg, ${alpha('#EEF2FF', 1)}, ${alpha('#E0E7FF', 0.65)})`,
    border: alpha('#C7D2FE', 0.85),
    text: '#3730A3',
    icon: 'linear-gradient(135deg, #6366F1, #4F46E5)',
    shadow: alpha('#6366F1', 0.32),
    glow: '#6366F1',
  },
  accent: {
    surface: `linear-gradient(135deg, ${alpha('#F0FDFA', 1)}, ${alpha('#CCFBF1', 0.65)})`,
    border: alpha('#99F6E4', 0.85),
    text: '#0F766E',
    icon: 'linear-gradient(135deg, #14B8A6, #0D9488)',
    shadow: alpha('#14B8A6', 0.32),
    glow: '#14B8A6',
  },
  warm: {
    surface: `linear-gradient(135deg, ${alpha('#FFFBEB', 1)}, ${alpha('#FEF3C7', 0.65)})`,
    border: alpha('#FDE68A', 0.85),
    text: '#92400E',
    icon: 'linear-gradient(135deg, #F59E0B, #D97706)',
    shadow: alpha('#F59E0B', 0.32),
    glow: '#F59E0B',
  },
  purple: {
    surface: `linear-gradient(135deg, ${alpha('#FAF5FF', 1)}, ${alpha('#F3E8FF', 0.65)})`,
    border: alpha('#E9D5FF', 0.85),
    text: '#6B21A8',
    icon: 'linear-gradient(135deg, #A855F7, #7C3AED)',
    shadow: alpha('#A855F7', 0.32),
    glow: '#A855F7',
  },
};

export function StatCard({
  icon,
  value,
  label,
  tone = 'primary',
  badge,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  tone?: 'primary' | 'accent' | 'warm' | 'purple';
  badge?: string;
}) {
  const t = tonePaletteMap[tone];
  return (
    <MuiCard
      variant="outlined"
      sx={{
        p: 0,
        background: t.surface,
        border: `1px solid ${t.border}`,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '18px',
        transition: 'all 380ms cubic-bezier(0.22, 1, 0.36, 1)',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: `0 18px 36px -10px ${t.shadow}`,
        },
      }}
    >
      <CardContent sx={{ p: 0 }}>
        <Box sx={{ p: { xs: 5, md: 6 }, position: 'relative' }}>
          <Box
            sx={{
              position: 'absolute',
              right: -24,
              top: -24,
              width: 112,
              height: 112,
              borderRadius: '50%',
              opacity: 0.32,
              filter: 'blur(28px)',
              background: t.glow,
            }}
          />
          <Avatar
            sx={{
              width: 48,
              height: 48,
              borderRadius: 3,
              background: t.icon,
              boxShadow: `0 10px 22px -6px ${t.shadow}`,
              mb: 3,
              color: '#fff',
            }}
            variant="square"
          >
            <Box sx={{ display: 'flex', color: '#fff' }}>{icon}</Box>
          </Avatar>
          <Typography
            sx={{
              fontSize: { xs: 34, md: 44 },
              fontWeight: 900,
              letterSpacing: '-0.03em',
              color: '#0F172A',
              mb: 0.75,
              lineHeight: 1.05,
            }}
          >
            {value}
          </Typography>
          <Typography
            sx={{ fontWeight: 600, color: '#475569', fontSize: 14 }}
          >
            {label}
          </Typography>
          {badge && (
            <Box sx={{ mt: 3 }}>
              <Badge variant="gray" sx={{ fontSize: 10, px: 0.25 }}>
                {badge}
              </Badge>
            </Box>
          )}
        </Box>
      </CardContent>
    </MuiCard>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = 'left',
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}) {
  const alignSx: any =
    align === 'center'
      ? { textAlign: 'center', mx: 'auto' }
      : { textAlign: 'left' };
  return (
    <Box sx={{ maxWidth: 768, mb: 8, ...alignSx }}>
      {eyebrow && (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1.5,
            mb: 2.5,
          }}
        >
          <Box
            sx={{
              width: 32,
              height: 2,
              borderRadius: 999,
              background: 'linear-gradient(90deg, #6366F1, #14B8A6)',
            }}
          />
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: '#4F46E5',
            }}
          >
            {eyebrow}
          </Typography>
        </Box>
      )}
      <Typography
        sx={{
          fontSize: { xs: 32, md: 42 },
          fontWeight: 900,
          letterSpacing: '-0.025em',
          color: '#0F172A',
          mb: 2,
        }}
      >
        {title}
      </Typography>
      {subtitle && (
        <Typography
          sx={{
            color: '#475569',
            lineHeight: 1.7,
            fontSize: { xs: 15, md: 17 },
            fontWeight: 500,
          }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

export function Divider({ label }: { label?: string }) {
  if (label) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          my: 10,
        }}
      >
        <Box
          sx={{
            flex: 1,
            maxWidth: 120,
            height: 1,
            background: 'linear-gradient(90deg, transparent, #CBD5E1, transparent)',
          }}
        />
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#94A3B8',
          }}
        >
          {label}
        </Typography>
        <Box
          sx={{
            flex: 1,
            maxWidth: 120,
            height: 1,
            background: 'linear-gradient(90deg, transparent, #CBD5E1, transparent)',
          }}
        />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        my: 10,
        height: 1,
        background: 'linear-gradient(90deg, transparent, #E2E8F0, transparent)',
      }}
    />
  );
}

export function StatusBadge({ status }: { status: any }) {
  const map: Record<string, BadgeVariant> = {
    'awaiting committee report': 'yellow',
    adopted: 'green',
    amended: 'blue',
    'rejected with reasons': 'red',
    'not addressed': 'gray',
    confirmed: 'green',
    pending: 'yellow',
    rejected: 'red',
    completed: 'green',
    active: 'accent',
    draft: 'warm',
  };
  const v = map[status] || 'gray';
  return (
    <Badge variant={v} showIcon>
      {status}
    </Badge>
  );
}
