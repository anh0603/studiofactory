/** Design tokens from design.md #41 (frozen). */
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0D10',
        surface: '#12161C',
        border: '#252B34',
        accent: '#FF6B35',
        ink: '#F5F7FA',
        secondary: '#9AA4B2',
        muted: '#667085',
      },
    },
  },
  plugins: [],
} satisfies Config
