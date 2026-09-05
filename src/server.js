import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { createOidc } from "./oidc.js";
import { ensureDataDirs, sweepAbandoned } from "./storage.js";
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
  // An abandoned entry-choice upload (docs/adr/0012) must never accumulate
  // across restarts either — a failing sweep must never stop the server from
  // starting.
  await sweepAbandoned(config).catch((err) => console.error(err));
  await runMigrations(config);

  const pool = createPool(config);
  const oidcConfig = await createOidc(config);

  const fastify = buildServer(config, { pool, oidcConfig });

  await fastify.listen({ host: config.bindAddress, port: config.port });
}

main();
