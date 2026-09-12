import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Web build of the dyad renderer.
 *
 * Identical to the Electron renderer build, plus:
 *  - output goes to dist/renderer (served statically by src/web/web_server.ts)
 *  - dev mode proxies the WebSocket IPC bridge (/__dyad_ipc) to the Node
 *    backend on :3000, so `npm run web:dev` works end-to-end.
 */
export default defineConfig(({ mode }) => ({
  base: "/",
  plugins: [
    // NOTE: babel-plugin-react-compiler is skipped in the web build — it
    // doubles build time/memory for an optimization that is not required to
    // run the app. The Electron renderer build keeps it.
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Web (SaaS) renderer runtime: unlocks pro-tier agent features in the UI
    // (see isWebRuntime() in src/lib/schemas.ts).
    "globalThis.__DYAD_WEB__": "true",
  },
  // Tailwind v4 is handled by @tailwindcss/vite; the parent project's
  // postcss.config (tailwind v3) must not leak into the renderer build.
  css: {
    postcss: {},
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/__dyad_ipc": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/__dyad_health": {
        target: "http://localhost:3000",
      },
    },
  },
}));
