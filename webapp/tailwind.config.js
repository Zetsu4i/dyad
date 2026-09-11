/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#09090b",
          1: "#101013",
          2: "#18181b",
          3: "#1f1f23",
          4: "#27272a",
        },
        line: {
          DEFAULT: "#27272a",
          strong: "#3f3f46",
        },
        ink: {
          DEFAULT: "#fafafa",
          dim: "#d4d4d8",
          mute: "#a1a1aa",
          faint: "#71717a",
        },
        accent: {
          DEFAULT: "#818cf8",
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
      spacing: {
        "4.5": "1.125rem",
        "7.5": "1.875rem",
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
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        pulseSoft: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.45" } },
      },
    },
  },
  plugins: [],
};
