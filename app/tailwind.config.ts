import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090c',
          900: '#0b0d10',
          850: '#0f1218',
          800: '#14171c',
          700: '#1b2029',
          600: '#242b36',
          500: '#333c4a',
        },
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#a58fff',
          dim: '#4b3aa8',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
      boxShadow: {
        sheet: '0 -18px 48px rgba(0,0,0,.55)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(18px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
};

export default config;
