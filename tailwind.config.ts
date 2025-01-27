import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#3083DC",
        secondary: "#FF5714",
        "secondary-light": "#FFBFA6",
        light: "#97d4ff",
        base: "#FBF2C0",
        dark: "#01161E",
        accent: "#FFE3E3",
      },
    },
  },
  plugins: [],
} satisfies Config;
