import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#edfcf5',
          100: '#d3f9e5',
          200: '#aaf1cf',
          300: '#72e4b2',
          400: '#38cf8e',
          500: '#14b876',
          600: '#089460',
          700: '#067650',
          800: '#085d40',
          900: '#074d36',
        },
      },
    },
  },
  plugins: [],
};

export default config;
