// Resets the workspace database (apps, chats, settings). Sandbox working
// copies under .data/apps are removed too.
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), ".data");
for (const entry of ["dyad-cloud.db", "dyad-cloud.db-wal", "dyad-cloud.db-shm"]) {
  const p = path.join(dataDir, entry);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    console.log("removed", p);
  }
}
const appsDir = path.join(dataDir, "apps");
if (fs.existsSync(appsDir)) {
  fs.rmSync(appsDir, { recursive: true, force: true });
  console.log("removed", appsDir);
}
console.log("Workspace database reset.");
