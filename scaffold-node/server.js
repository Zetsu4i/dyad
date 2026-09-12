/**
 * General-purpose Node.js server scaffold.
 *
 * Serves a small landing page and exposes a JSON API so the agent has a
 * starting point it can grow into anything: a web app, an API, a bot
 * backend, a tool, etc.
 *
 * The dev-server port is passed by the runtime as `--port <port>` and also
 * accepted via the PORT environment variable (default 3000).
 */
import express from "express";

function getPort(): number {
  const portArg = process.argv.findIndex((a) => a === "--port");
  if (portArg !== -1 && process.argv[portArg + 1]) {
    const p = Number(process.argv[portArg + 1]);
    if (Number.isFinite(p)) return p;
  }
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return 3000;
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Node App</title>
    <style>
      * { box-sizing: border-box; margin: 0; }
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        min-height: 100vh; display: grid; place-items: center;
        background: #09090b; color: #f4f4f5;
      }
      .card { text-align: center; padding: 2rem; max-width: 34rem; }
      h1 { font-size: 1.75rem; font-weight: 600; letter-spacing: -0.02em; }
      p { margin-top: 0.75rem; color: #a1a1aa; line-height: 1.6; }
      code { background: #18181b; border: 1px solid #27272a; border-radius: 6px; padding: 0.15rem 0.4rem; font-size: 0.85em; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Node.js app is running</h1>
      <p>
        This is the general-purpose template. Ask the agent to build anything
        here &mdash; APIs, tools, bots, dashboards. The server entry is
        <code>server.js</code> and hot-restarts on the preview port.
      </p>
    </div>
  </body>
</html>`);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const port = getPort();
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
