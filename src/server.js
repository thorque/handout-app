import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { createOidc } from "./oidc.js";
import { ensureDataDirs } from "./storage.js";
import { buildServer } from "./app.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  await ensureDataDirs(config);
  await runMigrations(config);

  const pool = createPool(config);
  const oidcConfig = await createOidc(config);

  const fastify = buildServer(config, { pool, oidcConfig });

  await fastify.listen({ host: config.bindAddress, port: config.port });
}

main();
