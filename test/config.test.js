import { test } from "node:test";
import assert from "node:assert/strict";
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
    OIDC_ALLOW_INSECURE_HTTP: "true",
    SESSION_SECRET: "0123456789abcdef",
    SESSION_COOKIE_SECURE: "false",
    ...overrides,
  };
}

test("loadConfig({}) throws once naming all twelve variables", () => {
  assert.throws(
    () => loadConfig({}),
    (err) => {
      assert.equal(CONFIG_VARIABLES.length, 12);
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
});
