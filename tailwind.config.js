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
        secondary: '#FF5714',
        light: '#97d4ff',
        base: '#FBF2C0',
        dark: '#01161E',
        accent: '#FFE3E3',
      },
    },
  },
  plugins: [],
}
