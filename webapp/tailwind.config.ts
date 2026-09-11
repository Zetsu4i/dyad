import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#09090b", // zinc-950 page background
          1: "#101013", // raised
          2: "#18181b", // zinc-900 panel
          3: "#1f1f23", // panel hover
          4: "#27272a", // zinc-800 border/elevated
        },
        line: {
          DEFAULT: "#27272a",
          strong: "#3f3f46",
        },
        ink: {
          DEFAULT: "#fafafa", // zinc-50
          dim: "#d4d4d8", // zinc-300
          mute: "#a1a1aa", // zinc-400
          faint: "#71717a", // zinc-500
        },
        accent: {
          DEFAULT: "#818cf8", // indigo-400 — restrained brand accent
          strong: "#6366f1",
          soft: "rgba(99,102,241,0.12)",
        },
        ok: "#34d399",
        warn: "#fbbf24",
        err: "#f87171",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
        pop: "0 8px 30px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
      },
      animation: {
        "fade-in": "fadeIn .18s ease-out",
        "slide-up": "slideUp .22s cubic-bezier(0.16,1,0.3,1)",
        pulse-soft: "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulseSoft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
      },
    },
  },
  plugins: [],
} satisfies Config;
