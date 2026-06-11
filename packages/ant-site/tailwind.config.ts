import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      colors: {
        'aurora-violet': {
          50: 'var(--violet-50)',
          100: 'var(--violet-100)',
          200: 'var(--violet-200)',
          300: 'var(--violet-300)',
          400: 'var(--violet-400)',
          500: 'var(--violet-500)',
          600: 'var(--violet-600)',
          700: 'var(--violet-700)',
          800: 'var(--violet-800)',
          900: 'var(--violet-900)',
        },
        'aurora-pink': {
          50: 'var(--pink-50)',
          100: 'var(--pink-100)',
          200: 'var(--pink-200)',
          300: 'var(--pink-300)',
          400: 'var(--pink-400)',
          500: 'var(--pink-500)',
          600: 'var(--pink-600)',
          700: 'var(--pink-700)',
        },
        'aurora-orange': {
          50: 'var(--orange-50)',
          100: 'var(--orange-100)',
          200: 'var(--orange-200)',
          300: 'var(--orange-300)',
          400: 'var(--orange-400)',
          500: 'var(--orange-500)',
          600: 'var(--orange-600)',
        },
        'aurora-teal': { 400: 'var(--teal-400)', 500: 'var(--teal-500)' },
        'aurora-emerald': { 500: 'var(--emerald-500)' },
        'aurora-amber': { 500: 'var(--amber-500)' },
        'aurora-red': { 500: 'var(--red-500)' },
      },
    },
  },
  plugins: [],
};

export default config;
