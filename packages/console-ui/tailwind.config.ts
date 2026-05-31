import type { Config } from 'tailwindcss';

/**
 * Linear / Vercel-inspired dark palette tokens.
 *
 * Kept intentionally small: this is a dev tool, not a marketing site —
 * adding too many colors blurs the visual hierarchy when an engineer is
 * scanning live session data under time pressure.
 */
export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                surface: {
                    base: '#09090b',     // page background
                    raised: '#111114',   // cards, table backgrounds
                    sunken: '#050507',   // inset wells (timeline rows hover, etc.)
                    border: '#1f1f23',
                    'border-strong': '#2a2a30',
                },
                ink: {
                    primary: '#e4e4e7',
                    secondary: '#a1a1aa',
                    muted: '#71717a',
                },
                accent: {
                    indigo: '#818cf8',   // links, focus
                    emerald: '#34d399',  // live / success
                    rose: '#fb7185',     // errors
                    amber: '#fbbf24',    // warnings
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
            },
            boxShadow: {
                glow: '0 0 0 1px rgba(129, 140, 248, 0.4), 0 8px 24px -8px rgba(129, 140, 248, 0.3)',
                'soft': '0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px -4px rgba(0, 0, 0, 0.3)',
            },
            animation: {
                'fade-in': 'fade-in 200ms ease-out',
                'pulse-live': 'pulse-live 2s ease-in-out infinite',
            },
            keyframes: {
                'fade-in': {
                    from: { opacity: '0', transform: 'translateY(2px)' },
                    to: { opacity: '1', transform: 'translateY(0)' },
                },
                'pulse-live': {
                    '0%, 100%': { opacity: '1', transform: 'scale(1)' },
                    '50%': { opacity: '0.6', transform: 'scale(0.9)' },
                },
            },
            backdropBlur: {
                glass: '14px',
            },
        },
    },
} satisfies Config;
