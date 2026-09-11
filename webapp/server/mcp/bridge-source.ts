// The MCP bridge source that gets uploaded into each sandbox.
// Kept as a standalone asset (assets/mcp-bridge.mjs) so it can be linted and
// syntax-checked like a normal file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const MCP_BRIDGE_SOURCE = fs.readFileSync(
  path.resolve(here, "../../assets/mcp-bridge.mjs"),
  "utf8",
);
