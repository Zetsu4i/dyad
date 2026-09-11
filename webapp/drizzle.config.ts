import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DYAD_DB_PATH || ".data/dyad-cloud.db" },
} satisfies Config;
