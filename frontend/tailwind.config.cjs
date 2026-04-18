/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f0e8",
        panel: "#eee9de",
        panelStrong: "#e4ddd0",
        accent: "#4a7c59",
        accentWarm: "#c17a3a",
        success: "#2d7a4a",
        danger: "#b94040",
        muted: "#7a6e62",
      },
      boxShadow: {
        glow: "0 8px 32px rgba(80, 60, 40, 0.10)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "IBM Plex Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
