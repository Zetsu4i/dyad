import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Dyad Cloud: when running under the local runner, apps are previewed through
// the control plane at /api/preview/{appId}/ — vite gets `base` from the
// environment so asset URLs resolve through the proxy. In an E2B sandbox the
// variable is unset and the app is served at "/" exactly like upstream Dyad.
const previewBase = process.env.DYAD_PREVIEW_BASE;

export default defineConfig(() => ({
  base: previewBase || "/",
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    // The preview is proxied (or served cross-origin from the sandbox host);
    // the classic HMR websocket doesn't survive either path, so rely on
    // full reloads.
    hmr: false,
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
