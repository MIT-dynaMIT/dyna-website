/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3083DC',
        'primary-dark': '#1f5fa8',
        secondary: '#FF5714',
        'secondary-light': '#FFBFA6',
        light: '#97d4ff',
        base: '#FBF2C0',
        dark: '#01161E',
        accent: '#FFE3E3',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 25px -12px rgba(1, 22, 30, 0.18), 0 4px 10px -6px rgba(1, 22, 30, 0.08)',
        'card-hover': '0 20px 45px -15px rgba(1, 22, 30, 0.25), 0 8px 18px -10px rgba(1, 22, 30, 0.12)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
}
