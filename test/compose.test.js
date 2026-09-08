// These checks read compose.yaml as text, not as parsed YAML: this project
// keeps its dependency list short by decision
// (docs/adr/0002-fastify-and-seven-more.md,
// docs/adr/0008-development-tooling-is-not-a-runtime-dependency.md) and a YAML
// parser would be a dependency bought for one test. The cost is that the
// checks see the file, not the service each line belongs to.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CONFIG_VARIABLES } from "../src/config.js";

const read = (name) =>
  fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const compose = read("compose.yaml");
const readme = read("README.md");
const realm = JSON.parse(read("keycloak/realm.json"));
const client = realm.clients.find((c) => c.clientId === "handout-web");

// The one origin this deployment serves, and the one the sign-in is registered
// for. It appears in the compose, in the realm and in the README, and the
// checks below are what keeps those three from drifting apart.
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

test("the issuer the application is given is the origin Keycloak is published under", () => {
  assert.ok(compose.includes(`OIDC_ISSUER_URL: ${ISSUER}`));
  assert.match(compose, /^\s+- "8081:8080"$/m);
  assert.match(compose, /^\s+- "8080:8080"$/m);
  assert.equal(new URL(ISSUER).port, "8081");
});

test("the README names the address, the sign-in and the provider the compose brings up", () => {
  assert.ok(readme.includes(ORIGIN));
  assert.ok(readme.includes("miriam"));
  assert.ok(readme.includes("http://localhost:8081"));
});
