// The production example (deploy/) is a second, self-contained deployment next
// to the local one (docs/adr/0030). These checks hold the two together and hold
// the operator chapter of the README to what the files actually need. Files are
// read as text, not parsed, for the reason test/compose.test.js gives.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CONFIG_VARIABLES } from "../src/config.js";
import { TLS_CHECK_PATH } from "../src/routes/operations.js";

const read = (name) =>
  fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

const withoutComments = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const localCompose = read("compose.yaml");
const deployCompose = read("deploy/compose.yaml");
const deployComposeCode = withoutComments(deployCompose);
const envExample = read("deploy/.env.example");
const deployCaddy = read("deploy/caddy/Caddyfile");
const deployCaddyCode = withoutComments(deployCaddy);
const localCaddy = read("caddy/Caddyfile");
const readme = read("README.md");
const realm = JSON.parse(read("deploy/keycloak/realm.json"));
const localRealm = JSON.parse(read("keycloak/realm.json"));

const envKeys = envExample
  .split("\n")
  .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line))
  .filter(Boolean)
  .map((match) => match[1]);

// The block of a site whose address line satisfies `isAddress`: from that line
// to the closing brace at column 0.
function siteBlock(text, isAddress) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /\{$/.test(line) && isAddress(line));
  assert.notEqual(start, -1, "site block not found");
  const end = lines.findIndex((line, i) => i > start && line === "}");
  return lines.slice(start, end + 1).join("\n");
}

test("both compose files pin the same image version", () => {
  const pattern = /ghcr\.io\/thorque\/handout-app:(\d+\.\d+\.\d+)/g;
  const found = [
    ...[...localCompose.matchAll(pattern)],
    ...[...deployCompose.matchAll(pattern)],
  ].map((match) => match[1]);
  assert.equal(found.length, 4);
  assert.equal(new Set(found).size, 1);
});

test("the production compose sets every configuration variable the application requires", () => {
  for (const name of CONFIG_VARIABLES) {
    assert.match(
      deployComposeCode,
      new RegExp("^\\s+" + name + ": \\S", "m"),
      `deploy/compose.yaml does not set ${name}`,
    );
  }
});

test("the production compose is a deployment, with a Secure session cookie", () => {
  assert.match(deployComposeCode, /SESSION_COOKIE_SECURE: "true"/);
  assert.doesNotMatch(deployComposeCode, /SESSION_COOKIE_SECURE: "false"/);
});

test("every variable the production compose uses is declared in .env.example, and every declared one is used", () => {
  const used = new Set(
    [...deployComposeCode.matchAll(/\$\{([A-Z][A-Z0-9_]*)(:\?[^}]+)?\}/g)].map(
      (match) => match[1],
    ),
  );
  for (const key of used) {
    assert.ok(envKeys.includes(key), `${key} is used but not declared`);
  }
  for (const key of envKeys) {
    assert.ok(used.has(key), `${key} is declared but never used`);
  }
});

test("every variable the production compose uses is required, so a missing one stops the start", () => {
  const bare = deployComposeCode.match(/\$\{[A-Z][A-Z0-9_]*\}/g);
  assert.equal(bare, null, `blank references: ${bare}`);
});

test("the README names every variable of the deployment", () => {
  for (const key of envKeys) {
    assert.ok(readme.includes(key), `README.md does not mention ${key}`);
  }
});

test("the README names every volume of the production compose", () => {
  const section = deployComposeCode.slice(
    deployComposeCode.lastIndexOf("\nvolumes:"),
  );
  const volumes = [...section.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map(
    (match) => match[1],
  );
  assert.equal(volumes.length, 4);
  for (const volume of volumes) {
    assert.ok(readme.includes(volume), `README.md does not mention ${volume}`);
  }
});

test("the ask path is the same string in the code and in both Caddyfiles", () => {
  assert.ok(
    deployCaddyCode.includes(
      `ask http://{$APP_HOST}:{$APP_PORT}${TLS_CHECK_PATH}\n`,
    ),
  );
  assert.ok(deployCaddyCode.includes(`handle ${TLS_CHECK_PATH}*`));
  assert.ok(localCaddy.includes(`handle ${TLS_CHECK_PATH}*`));
  // Both blocks that proxy to the application import the deny.
  const imports = deployCaddyCode.match(/^\s+import deny-internal-routes$/gm);
  assert.equal(imports.length, 2);
  assert.ok(
    siteBlock(deployCaddyCode, (l) =>
      l.startsWith("{$HANDOUT_DOMAIN}"),
    ).includes("import deny-internal-routes"),
  );
  assert.ok(
    siteBlock(deployCaddyCode, (l) => l.startsWith("*.")).includes(
      "import deny-internal-routes",
    ),
  );
});

test("on-demand TLS is on the hostname pattern only, and the Keycloak block is automated explicitly", () => {
  assert.equal(deployCaddyCode.match(/^\s+on_demand$/gm).length, 1);
  assert.ok(
    siteBlock(deployCaddyCode, (l) => l.startsWith("*.")).includes("on_demand"),
  );
  const keycloak = siteBlock(deployCaddyCode, (l) =>
    l.startsWith("{$KEYCLOAK_DOMAIN}"),
  );
  // force_automate is an argument of the tls directive, not a subdirective;
  // the block form fails to adapt.
  assert.match(keycloak, /^\ttls force_automate$/m);
  assert.doesNotMatch(keycloak, /tls \{/);
  assert.ok(!keycloak.includes("on_demand"));
});

test("the production realm carries no users and no literal secret", () => {
  assert.equal(realm.users, undefined);
  assert.equal(realm.sslRequired, "external");
  const client = realm.clients.find((c) => c.clientId === "handout-web");
  assert.ok(client.secret.startsWith("${"));
});

test("the local realm fixture keeps its users", () => {
  assert.equal(localRealm.users.length, 2);
});
