import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, CONFIG_VARIABLES } from "../src/config.js";

function completeEnv(overrides = {}) {
  return {
    PORT: "3000",
    BIND_ADDRESS: "0.0.0.0",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/handout",
    HANDOUT_DATA_DIR: "/tmp/handout-data",
    MAX_UPLOAD_BYTES: "524288000",
    OIDC_ISSUER_URL: "http://issuer.example/realms/handout",
    OIDC_BACKCHANNEL_URL: "http://backchannel.example/realms/handout",
    OIDC_CLIENT_ID: "handout-web",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REQUIRED_ROLE: "publisher",
    OIDC_ALLOW_INSECURE_HTTP: "true",
    SESSION_SECRET: "0123456789abcdef",
    SESSION_COOKIE_SECURE: "false",
    ...overrides,
  };
}

test("loadConfig({}) throws once naming all thirteen variables", () => {
  assert.throws(
    () => loadConfig({}),
    (err) => {
      assert.equal(CONFIG_VARIABLES.length, 13);
      for (const name of CONFIG_VARIABLES) {
        assert.ok(
          err.message.includes(name),
          `expected message to mention ${name}`,
        );
      }
      return true;
    },
  );
});

test("MAX_UPLOAD_BYTES of 0 is rejected", () => {
  assert.throws(
    () => loadConfig(completeEnv({ MAX_UPLOAD_BYTES: "0" })),
    (err) => err.message.includes("MAX_UPLOAD_BYTES"),
  );
});

test("MAX_UPLOAD_BYTES of '500MB' is rejected", () => {
  assert.throws(
    () => loadConfig(completeEnv({ MAX_UPLOAD_BYTES: "500MB" })),
    (err) => err.message.includes("MAX_UPLOAD_BYTES"),
  );
});

test("MAX_UPLOAD_BYTES of '-1' is rejected", () => {
  assert.throws(
    () => loadConfig(completeEnv({ MAX_UPLOAD_BYTES: "-1" })),
    (err) => err.message.includes("MAX_UPLOAD_BYTES"),
  );
});

test("SESSION_COOKIE_SECURE only accepts true/false", () => {
  assert.throws(
    () => loadConfig(completeEnv({ SESSION_COOKIE_SECURE: "yes" })),
    (err) => err.message.includes("SESSION_COOKIE_SECURE"),
  );
});

test("a complete environment returns typed values", () => {
  const config = loadConfig(completeEnv());
  assert.strictEqual(config.maxUploadBytes, 524288000);
  assert.strictEqual(typeof config.maxUploadBytes, "number");
  assert.strictEqual(config.sessionCookieSecure, false);
  assert.strictEqual(typeof config.sessionCookieSecure, "boolean");
  assert.strictEqual(config.port, 3000);
  assert.strictEqual(config.oidcAllowInsecureHttp, true);
  assert.strictEqual(config.oidcRequiredRole, "publisher");
});

test("a missing OIDC_REQUIRED_ROLE is named, and nothing else is", () => {
  const env = completeEnv();
  delete env.OIDC_REQUIRED_ROLE;
  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.equal(
        err.message,
        "Missing required environment variables: OIDC_REQUIRED_ROLE",
      );
      return true;
    },
  );
});

test("the start aborts and names OIDC_REQUIRED_ROLE when it is missing", () => {
  const envWithoutRole = completeEnv();
  delete envWithoutRole.OIDC_REQUIRED_ROLE;
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../src/server.js", import.meta.url))],
    {
      env: { PATH: process.env.PATH, ...envWithoutRole },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OIDC_REQUIRED_ROLE/);
});
