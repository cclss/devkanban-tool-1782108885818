import type { Config } from 'tailwindcss';

/**
 * Design-system theme.
 *
 * Color / radius / shadow / spacing / typography names map to semantic CSS
 * custom properties defined in `globals.css`. Keeping the raw values in CSS
 * variables (rather than literals here) is what lets a sender override the
 * brand color at runtime — see the `--brand-*` hook in globals.css.
 */
const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    // Pull in shared UI package source so its utility classes are detected.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  // The /_design showcase builds a few class names dynamically (one per token in
  // a scale); the scanner can't see those, so the scale utilities are safelisted.
  safelist: [
    'text-display',
    'text-3xl',
    'text-2xl',
    'text-xl',
    'text-lg',
    'text-md',
    'text-base',
    'text-sm',
    'text-xs',
    'text-2xs',
    'rounded-xs',
    'rounded-sm',
    'rounded-md',
    'rounded-lg',
    'rounded-xl',
    'rounded-2xl',
    'shadow-xs',
    'shadow-sm',
    'shadow-md',
    'shadow-lg',
    'shadow-xl',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          muted: 'var(--color-surface-muted)',
        },
        foreground: {
          DEFAULT: 'var(--color-foreground)',
          muted: 'var(--color-foreground-muted)',
          subtle: 'var(--color-foreground-subtle)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
          hover: 'var(--color-primary-hover)',
          pressed: 'var(--color-primary-pressed)',
          subtle: 'var(--color-primary-subtle)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          foreground: 'var(--color-success-foreground)',
          subtle: 'var(--color-success-subtle)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          foreground: 'var(--color-danger-foreground)',
          subtle: 'var(--color-danger-subtle)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          foreground: 'var(--color-warning-foreground)',
          subtle: 'var(--color-warning-subtle)',
        },
        grey: {
          50: 'var(--grey-50)',
          100: 'var(--grey-100)',
          200: 'var(--grey-200)',
          300: 'var(--grey-300)',
          400: 'var(--grey-400)',
          500: 'var(--grey-500)',
          600: 'var(--grey-600)',
          700: 'var(--grey-700)',
          800: 'var(--grey-800)',
          900: 'var(--grey-900)',
        },
        ring: 'var(--color-ring)',
        focus: {
          DEFAULT: 'var(--color-focus)',
          danger: 'var(--color-focus-danger)',
        },
        overlay: 'var(--color-overlay)',
      },
      fontFamily: {
        sans: [
          '"Pretendard Variable"',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          '"Segoe UI"',
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          'sans-serif',
        ],
        // Typed-signature font set: a serif (명조) and a handwriting script
        // (손글씨), alongside `sans` (고딕). Loaded via @import in globals.css.
        serif: ['"Nanum Myeongjo"', 'serif'],
        script: ['"Nanum Pen Script"', 'cursive'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px
        xs: ['0.75rem', { lineHeight: '1.125rem' }], // 12px
        sm: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px
        base: ['0.9375rem', { lineHeight: '1.5rem' }], // 15px
        md: ['1.0625rem', { lineHeight: '1.625rem' }], // 17px
        lg: ['1.1875rem', { lineHeight: '1.75rem' }], // 19px
        xl: ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.01em' }], // 22px
        '2xl': ['1.625rem', { lineHeight: '2.125rem', letterSpacing: '-0.015em' }], // 26px
        '3xl': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }], // 32px
        display: ['2.5rem', { lineHeight: '3rem', letterSpacing: '-0.025em' }], // 40px
      },
      borderRadius: {
        xs: '6px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(13, 16, 21, 0.04)',
        sm: '0 1px 3px rgba(13, 16, 21, 0.06), 0 1px 2px rgba(13, 16, 21, 0.04)',
        md: '0 4px 16px rgba(13, 16, 21, 0.08)',
        lg: '0 8px 28px rgba(13, 16, 21, 0.12)',
        xl: '0 16px 48px rgba(13, 16, 21, 0.16)',
      },
      spacing: {
        '2xs': '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px',
        '3xl': '64px',
      },
      transitionDuration: {
        instant: '100ms',
        fast: '150ms',
        base: '250ms',
        slow: '400ms',
        slower: '600ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
        'out-expressive': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-soft': 'cubic-bezier(0.4, 0, 1, 1)',
        bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'blob-flow': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(3%, -4%) scale(1.08)' },
          '66%': { transform: 'translate(-3%, 3%) scale(0.95)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
        // A calm ring that expands and fades to draw the eye to a field still
        // needing a signature, then resets invisibly (spread 0, transparent) for
        // a seamless loop. The ring rides on `--color-primary`, so it re-skins to
        // the sender's brand. The field's own static border/background carry the
        // highlight, so under reduced-motion (ring stopped) it stays clearly marked.
        'breathing-pulse': {
          '0%': {
            boxShadow: '0 0 0 0 color-mix(in srgb, var(--color-primary) 45%, transparent)',
          },
          '70%': {
            boxShadow: '0 0 0 7px color-mix(in srgb, var(--color-primary) 0%, transparent)',
          },
          '100%': {
            boxShadow: '0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent)',
          },
        },
        'step-bounce': {
          '0%': { transform: 'scale(0.6)' },
          '60%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
        'checkmark-draw': {
          from: { strokeDashoffset: 'var(--draw-length, 48)' },
          to: { strokeDashoffset: '0' },
        },
        'confetti-burst': {
          '0%': { transform: 'translate3d(0, 0, 0) rotate(0deg)', opacity: '1' },
          '100%': {
            transform:
              'translate3d(var(--confetti-x, 0), var(--confetti-y, 0), 0) rotate(var(--confetti-rotate, 360deg))',
            opacity: '0',
          },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'content-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'content-out': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
          to: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
        },
        'sheet-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'sheet-out-bottom': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
        'sheet-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'sheet-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'wizard-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'wizard-in-left': {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        blob: 'blob-flow 18s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        shake: 'shake 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        'breathing-pulse': 'breathing-pulse 2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'step-bounce': 'step-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        checkmark: 'checkmark-draw 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        confetti: 'confetti-burst 1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'overlay-in': 'overlay-in 0.2s ease-out',
        'overlay-out': 'overlay-out 0.2s ease-in',
        'content-in': 'content-in 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'content-out': 'content-out 0.2s cubic-bezier(0.4, 0, 1, 1)',
        'sheet-in-bottom': 'sheet-in-bottom 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'sheet-out-bottom': 'sheet-out-bottom 0.24s cubic-bezier(0.4, 0, 1, 1)',
        'sheet-in-right': 'sheet-in-right 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'sheet-out-right': 'sheet-out-right 0.24s cubic-bezier(0.4, 0, 1, 1)',
        'wizard-forward': 'wizard-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'wizard-back': 'wizard-in-left 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
