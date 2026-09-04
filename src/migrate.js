import { fileURLToPath } from "node:url";
import path from "node:path";
import { runner } from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

export async function runMigrations(config) {
  await runner({
    databaseUrl: config.databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
  });
}
