import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { loadConfig } from "../../src/config.js";
import { createPool } from "../../src/db.js";
import { runMigrations } from "../../src/migrate.js";
import { createOidc } from "../../src/oidc.js";
import { buildServer } from "../../src/app.js";
import { ensureDataDirs } from "../../src/storage.js";
import { signSessionValue } from "../../src/session.js";
import { startStubOidc } from "./oidc-stub.js";

const { Client } = pg;

function databaseUrlFor(name) {
  const url = new URL(process.env.POSTGRES_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withAdminClient(fn) {
  const client = new Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(name) {
  await withAdminClient(async (client) => {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  });
}

async function dropDatabase(name) {
  await withAdminClient(async (client) => {
    await client.query(`drop database if exists "${name}" with (force)`);
  });
}

async function createTempDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "handout-test-"));
}

// Creates its own test database (handout_test), a temp data directory and, by
// default, an in-process stub OIDC provider, then boots the real application
// against them. `overrides.env` layers on top of the defaults for tests that
// need a deliberately different configuration (e.g. the OIDC origin split).
export async function buildTestServer(overrides = {}) {
  const dbName = overrides.dbName || "handout_test";
  await recreateDatabase(dbName);

  const dataDir = await createTempDataDir();

  const clientId = overrides.oidcClientId || "handout-web";
  const clientSecret = overrides.oidcClientSecret || "test-client-secret";

  const ownStub = !overrides.stub;
  const stub =
    overrides.stub ||
    (await startStubOidc({
      clientId,
      clientSecret,
      issuer: overrides.stubIssuer,
      user: overrides.oidcUser,
    }));

  const env = {
    PORT: "3000", // config.port itself is unused in tests; we always listen on an ephemeral port
    BIND_ADDRESS: "127.0.0.1",
    DATABASE_URL: databaseUrlFor(dbName),
    HANDOUT_DATA_DIR: dataDir,
    MAX_UPLOAD_BYTES: String(overrides.maxUploadBytes || 524288000),
    OIDC_ISSUER_URL: stub.url,
    OIDC_BACKCHANNEL_URL: stub.url,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_ALLOW_INSECURE_HTTP: "true",
    SESSION_SECRET: "test-session-secret-0123456789abcdef0123",
    SESSION_COOKIE_SECURE: "false",
    ...overrides.env,
  };

  const config = loadConfig(env);
  await ensureDataDirs(config);
  await runMigrations(config);

  const pool = createPool(config);
  const oidcConfig = await createOidc(config);

  const fastify = buildServer(config, { pool, oidcConfig });
  await fastify.ready();
  await fastify.listen({ host: "127.0.0.1", port: 0 });
  const address = fastify.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    fastify,
    config,
    pool,
    stub,
    baseUrl,
    signSession(claims) {
      return `handout_session=${signSessionValue(config, claims)}`;
    },
    async close() {
      await fastify.close();
      await pool.end();
      if (ownStub) await stub.close();
      await fs.rm(dataDir, { recursive: true, force: true });
      await dropDatabase(dbName);
    },
  };
}
