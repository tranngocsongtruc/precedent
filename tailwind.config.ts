import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0f",
        panel: "#13131a",
        edge: "#26263a",
        accent: "#7c5cff",
        approve: "#34d399",
        deny: "#f87171",
        pending: "#fbbf24",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
