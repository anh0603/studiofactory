/** Design tokens from design.md #41 + motion tokens for the interaction pass.
 *
 * Colors are CSS-channel variables so the whole UI flips between light
 * (default) and dark (`.dark` on <html>) without touching any class.
 * `--c-*` holds "R G B" channels; utilities resolve via <alpha-value>.
 */
import { heroui } from '@heroui/react'
import type { Config } from 'tailwindcss'

const chan = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: chan('bg'),
        surface: chan('surface'),
        panel: chan('panel'),
        raised: chan('raised'),
        elevated: chan('elevated'),
        chrome: chan('chrome'),
        border: chan('border'),
        accent: chan('accent'),
        ink: chan('ink'),
        secondary: chan('secondary'),
        muted: chan('muted'),
        ember: chan('ember'),
        warn: chan('warn'),
        ok: chan('ok'),
        bad: chan('bad'),
        cyan: chan('cyan'),
        pink: chan('pink'),
        blue: chan('blue'),
        tint: chan('tint'),
        emberline: chan('emberline'),
      },
      transitionDuration: {
        micro: '130ms',
        hover: '150ms',
        panel: '180ms',
        page: '200ms',
        state: '280ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        inout: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-rise': {
          from: { opacity: '0', transform: 'translate3d(0, 4px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translate3d(0, 5px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translate3d(0, 8px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'toast-out': {
          from: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
          to: { opacity: '0', transform: 'translate3d(0, -4px, 0)' },
        },
        'dot-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
        'state-swap': {
          from: { opacity: '0.4' },
          to: { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'panel-in': 'panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'toast-in': 'toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'toast-out': 'toast-out 150ms cubic-bezier(0.4, 0, 0.2, 1) both',
        'dot-pulse': 'dot-pulse 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'state-swap': 'state-swap 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        spin: 'spin 700ms linear infinite',
      },
    },
  },
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            primary: { DEFAULT: '#8B7CF6', foreground: '#FFFFFF' },
            focus: '#8B7CF6',
          },
        },
        dark: {
          colors: {
            primary: { DEFAULT: '#8B7CF6', foreground: '#FFFFFF' },
            focus: '#8B7CF6',
          },
        },
      },
    }),
  ],
} satisfies Config
