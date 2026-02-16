/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#060910',
          card: '#0D1117',
          surface: '#161B22',
          border: '#21262D',
          hover: '#1C2128',
        },
        sla: {
          breached: '#EF4444',
          critical: '#F59E0B',
          warning: '#F97316',
          ok: '#22C55E',
        },
        ssc: {
          gold: '#FCD34D',
          bg: 'rgba(245, 158, 11, 0.13)',
          border: 'rgba(245, 158, 11, 0.3)',
        },
        accent: {
          blue: '#3B82F6',
          purple: '#8B5CF6',
          teal: '#14B8A6',
          pink: '#EC4899',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
