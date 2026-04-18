/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#07111f",
        panel: "#0d1b2a",
        panelStrong: "#10253c",
        accent: "#5eead4",
        accentWarm: "#f59e0b",
        success: "#22c55e",
        danger: "#fb7185",
        muted: "#8aa0b8",
      },
      boxShadow: {
        glow: "0 20px 60px rgba(15, 23, 42, 0.45)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "IBM Plex Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
