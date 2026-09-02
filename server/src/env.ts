import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

const devDataDir = path.resolve(process.cwd(), ".local-data");

export const dataDir = path.resolve(process.env.OPENHARNESS_DATA_DIR ?? devDataDir);
export const workspaceDir = path.resolve(
  process.env.OPENHARNESS_WORKSPACE ?? path.join(dataDir, "workspace"),
);
export const skillsDir = path.resolve(
  process.env.OPENHARNESS_SKILLS_DIR ?? path.join(dataDir, "skills"),
);

for (const envFile of [path.join(dataDir, ".env"), path.resolve(process.cwd(), ".env")]) {
  dotenv.config({ path: envFile });
}

fs.mkdirSync(workspaceDir, { recursive: true });
fs.mkdirSync(skillsDir, { recursive: true });

if (!process.env.DATABASE_URL) {
  const databaseFile = path.join(dataDir, "openharness.db").replaceAll("\\", "/");
  fs.closeSync(fs.openSync(databaseFile, "a"));
  process.env.DATABASE_URL = `file:${databaseFile}?connection_limit=1`;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? process.env.OPENHARNESS_PORT ?? 8878),
  enableBash: process.env.OPENHARNESS_ENABLE_BASH === "true",
  contextWindow: Number(process.env.OPENHARNESS_CONTEXT_WINDOW ?? 128_000),
};
