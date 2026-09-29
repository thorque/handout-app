// The local trial (scenario 2 of the README's "Four ways to run it"): the
// compose at the root, run with env/2-local.env.example. These checks hold
// that env file, the compose, the realm fixture and the deployment guide together. The
// checks that hold all scenarios together are in test/deployment.test.js. Files
// are read as text, for the reason test/helpers/deployment-files.js gives.

import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_VARIABLES } from "../src/config.js";
import { read, parseEnv } from "./helpers/deployment-files.js";

const compose = read("compose.yaml");
const guide = read("docs/deployment.md");
const local = parseEnv(read("env/2-local.env.example"));
const realm = JSON.parse(read("keycloak/realm.json"));
const client = realm.clients.find((c) => c.clientId === "handout-web");

// The one origin the trial serves, and the one the sign-in is registered for.
// It appears in the env file, in the realm and in the README, and the checks
// below are what keeps those from drifting apart.
const ORIGIN = "http://handout.localhost:8080";
const ISSUER = "http://localhost:8081/realms/handout";

test("the compose sets every configuration variable the application requires", () => {
  for (const name of CONFIG_VARIABLES) {
    assert.match(
      compose,
      new RegExp("^\\s+" + name + ": \\S", "m"),
      `compose.yaml does not set ${name}`,
    );
  }
});

test("the application comes from the registry at a pinned version, never from a build", () => {
  assert.match(
    compose,
    /^\s+image: ghcr\.io\/thorque\/handout-app:\d+\.\d+\.\d+$/m,
  );
  assert.doesNotMatch(compose, /image: ghcr\.io\/thorque\/handout-app:latest/);
  assert.doesNotMatch(compose, /^\s*build:/m);
});

test("the local origin's redirect and post-logout URIs are registered in the realm", () => {
  assert.ok(client.redirectUris.includes(ORIGIN + "/auth/callback"));
  assert.ok(
    client.attributes["post.logout.redirect.uris"]
      .split("##")
      .includes(ORIGIN + "/"),
  );
});

test("the realm pins no front-end URL, so its URLs follow the request", () => {
  assert.ok(
    realm.attributes === undefined ||
      realm.attributes.frontendUrl === undefined,
  );
});

test("the trial runs the fixture realm, with its secret, in development mode", () => {
  assert.equal(local.get("KEYCLOAK_REALM_FILE"), "./keycloak/realm.json");
  assert.equal(local.get("OIDC_CLIENT_ID"), client.clientId);
  assert.equal(local.get("OIDC_CLIENT_SECRET"), client.secret);
  assert.match(local.get("KEYCLOAK_COMMAND"), /^start-dev /);
  assert.equal(local.get("COMPOSE_PROFILES"), "keycloak");
});

test("the issuer the application is given is the origin Keycloak is published under", () => {
  assert.equal(local.get("OIDC_ISSUER_URL"), ISSUER);
  assert.equal(local.get("KC_HOSTNAME"), new URL(ISSUER).origin);
  assert.match(compose, /^\s+- "127\.0\.0\.1:8081:8080"$/m);
  assert.equal(new URL(ISSUER).port, "8081");
});

test("Caddy is published where the origin says, and answers on any host name there", () => {
  assert.equal(local.get("HTTP_PORT"), new URL(ORIGIN).port);
  assert.match(compose, /^\s+- "\$\{HTTP_PORT:\?[^}]*\}:80"$/m);
  // A port and no host name: one block for the publisher and its wildcard.
  assert.match(local.get("CADDY_SITE_ADDRESS"), /^:\d+$/);
  assert.equal(local.get("HANDOUT_DOMAIN"), new URL(ORIGIN).hostname);
});

test("the trial keeps its state beside the compose file, and the repository ignores it", () => {
  assert.equal(local.get("HANDOUT_STATE_DIR"), "./state");
  assert.match(read(".gitignore"), /^state\/$/m);
});

test("the deployment guide names the address, the sign-in and the provider the compose brings up", () => {
  assert.ok(guide.includes(ORIGIN));
  assert.ok(guide.includes("miriam"));
  assert.ok(guide.includes("http://localhost:8081"));
  assert.ok(
    guide.includes("docker compose --env-file env/2-local.env.example up"),
  );
});
