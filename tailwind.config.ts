import type { Config } from "tailwindcss";

// Colors are CSS variables so a single [data-theme] flip retones the whole app.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface-2)",
        border: "var(--border)",
        hairline: "var(--hairline)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        cta: "var(--cta)",
        "on-cta": "var(--on-cta)",
        approve: "var(--approve)",
        deny: "var(--deny)",
        pending: "var(--pending)",
        escalate: "var(--escalate)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.18), 0 8px 24px -12px rgba(0,0,0,0.35)",
        glow: "0 0 0 1px var(--accent-soft), 0 8px 30px -10px var(--accent-soft)",
      },
      borderRadius: { xl: "0.75rem" },
    },
  },
  plugins: [],
} satisfies Config;
