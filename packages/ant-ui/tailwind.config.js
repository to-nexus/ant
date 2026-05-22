
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'display': ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
        'aurora-teal': {
          300: 'var(--teal-400)',
          400: 'var(--teal-400)',
          500: 'var(--teal-500)',
        },
        'aurora-emerald': {
          400: 'var(--emerald-500)',
          500: 'var(--emerald-500)',
        },
        'aurora-amber': {
          500: 'var(--amber-500)',
        },
        'aurora-red': {
          500: 'var(--red-500)',
        },
      },
      typography: {
        DEFAULT: {
          css: {
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
          },
        },
      },
      containers: {
        'xs': '20rem',
        'sm': '24rem',
        'md': '28rem',
        'lg': '32rem',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
    function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          'scrollbar-width': 'none',
          '-ms-overflow-style': 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        },
      });
    },
  ],
};
