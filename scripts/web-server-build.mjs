#!/usr/bin/env node
/**
 * Builds the Dyad web server bundle (dist/web/server.cjs) with esbuild.
 *
 * - "electron" is aliased to src/web/electron_shim.ts so the entire
 *   main-process backend runs on a plain Node server.
 * - Vite-style `?raw` imports (markdown guides) are inlined as text.
 * - Native / heavy modules stay external and load from node_modules.
 */
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWatch = process.argv.includes("--watch");

const rawPlugin = {
  name: "dyad-raw-loader",
  setup(build) {
    // Vite's `?raw` suffix: load the file contents as a string.
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const stripped = args.path.slice(0, -4);
      const resolved = stripped.startsWith("@/")
        ? path.join(root, "src", stripped.slice(2))
        : path.resolve(args.resolveDir, stripped);
      return { path: resolved, namespace: "raw-file" };
    });
    build.onLoad({ filter: /.*/, namespace: "raw-file" }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8"),
      loader: "text",
    }));
    // Plain .md imports (if any): text.
    build.onLoad({ filter: /\.md$/ }, (args) => ({
      contents: fs.readFileSync(args.path, "utf8"),
      loader: "text",
    }));
  },
};

const ctx = await build({
  entryPoints: [path.join(root, "src/web/web_server.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(root, "dist/web/server.cjs"),
  alias: {
    electron: path.join(root, "src/web/electron_shim.ts"),
    // electron-log's "main" flavor requires the real electron module; the
    // "node" flavor has the identical logger API without it.
    "electron-log/main": path.join(root, "node_modules/electron-log/src/node/index.js"),
    "electron-log": path.join(root, "node_modules/electron-log/src/node/index.js"),
  },
  external: [
    "better-sqlite3",
    "node-pty",
    "dugite",
    "@vscode/ripgrep",
    "e2b",
    "ws",
    "keytar",
    "sharp",
    "cpu-features",
    "@mapbox/node-pre-gyp",
    "sqlite3",
    "ssh2",
  ],
  sourcemap: true,
  logLevel: "warning",
  plugins: [rawPlugin],
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "production",
    ),
  },
  banner: {
    js: [
      "// Dyad web server bundle (generated)",
      "if (typeof globalThis.__DYAD_WEB__ === 'undefined') { globalThis.__DYAD_WEB__ = true; }",
    ].join("\n"),
  },
});

if (isWatch) {
  console.log("[web-server-build] watching for changes...");
}
console.log("[web-server-build] done ->", path.join(root, "dist/web/server.cjs"));
