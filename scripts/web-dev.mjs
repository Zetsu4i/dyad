#!/usr/bin/env node
/**
 * Web dev orchestrator: builds + starts the backend server (esbuild watch)
 * and runs the vite renderer dev server with a WS proxy to the backend.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(name, command, args, color) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (stream, isError) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) console.log(`${prefix} ${line}`);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(`${prefix} exited with code ${code}`);
    }
  });
  return child;
}

// Backend: build once, run with --watch for rebuilds.
const server = run(
  "server",
  "node",
  [
    "node_modules/esbuild/build/esbuild",
    "src/web/web_server.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node20",
    "--outfile=dist/web/server.cjs",
    "--alias:electron=./src/web/electron_shim.ts",
    "--external:better-sqlite3",
    "--external:node-pty",
    "--external:dugite",
    "--external:@vscode/ripgrep",
    "--external:electron-log",
    "--external:e2b",
    "--external:keytar",
    "--external:sharp",
    "--external:@mapbox/node-pre-gyp",
    "--external:sqlite3",
    "--sourcemap",
    "--watch",
  ],
  "36",
);

setTimeout(() => {
  run("backend", "node", ["dist/web/server.cjs"], "32");
}, 4000);

setTimeout(() => {
  run("renderer", "node", ["node_modules/vite/bin/vite.js", "--config", "vite.web.config.mts"], "35");
}, 1000);

const shutdown = () => {
  console.log("\n[web-dev] shutting down");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
