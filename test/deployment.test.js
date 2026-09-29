// The four scenarios of the README's "Four ways to run it" share one
// caddy/Caddyfile and one compose.yaml (docs/adr/0032). What differs is a file
// of site blocks under caddy/sites/ and an env file under env/. These checks
// hold the shared parts together, hold each env file complete against the
// compose, and hold the deployment guide and the README to what the files
// actually need. Files are read as text, for the reason
// test/helpers/deployment-files.js gives.

import test from "node:test";
import assert from "node:assert/strict";
import { TLS_CHECK_PATH } from "../src/routes/operations.js";
import {
  read,
  exists,
  withoutComments,
  parseEnv,
  serviceBlock,
  siteBlocks,
} from "./helpers/deployment-files.js";

const compose = read("compose.yaml");
const composeCode = withoutComments(compose);
const readme = read("README.md");
const guide = read("docs/deployment.md");
const ci = read(".github/workflows/ci.yml");

const caddyfile = read("caddy/Caddyfile");
const caddyCode = withoutComments(caddyfile);

// The scenarios, each with the one env file and the one site file it is run
// with. Scenario 1 has no compose: the workbench sets Caddy's values on the
// host and gets the default site file.
const SCENARIOS = {
  1: { env: "env/1-workbench.env.example", site: "sites/local.caddyfile" },
  2: { env: "env/2-local.env.example", site: "sites/local.caddyfile" },
  3: {
    env: "env/3-production.env.example",
    site: "sites/edge-keycloak.caddyfile",
  },
  4: {
    env: "env/4-production-external-idp.env.example",
    site: "sites/edge.caddyfile",
  },
};
const COMPOSE_SCENARIOS = [2, 3, 4];
const envOf = (n) => parseEnv(read(SCENARIOS[n].env));
const siteOf = (n) => read("caddy/" + SCENARIOS[n].site);
const SITE_FILES = [...new Set(Object.values(SCENARIOS).map((s) => s.site))];

// Keys an env file sets for compose itself and the compose text never names.
const COMPOSE_OWN_KEYS = new Set(["COMPOSE_PROFILES"]);

const usedIn = (text) =>
  new Set(
    [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)(:[?-][^}]*)?\}/g)].map(
      (m) => m[1],
    ),
  );
const requiredIn = (text) =>
  new Set(
    [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?[^}]*\}/g)].map((m) => m[1]),
  );

test("the compose pins one image version, on every service that runs the application", () => {
  const found = [
    ...compose.matchAll(/ghcr\.io\/thorque\/handout-app:(\d+\.\d+\.\d+)/g),
  ].map((match) => match[1]);
  assert.equal(found.length, 2);
  assert.equal(new Set(found).size, 1);
});

test("every scenario sets the Secure cookie and plain-HTTP flags to what its origin is", () => {
  assert.equal(envOf(2).get("SESSION_COOKIE_SECURE"), "false");
  for (const n of [3, 4]) {
    assert.equal(
      envOf(n).get("SESSION_COOKIE_SECURE"),
      "true",
      `scenario ${n}`,
    );
  }
  // Plain HTTP against the provider is only for the hop inside the compose
  // network (scenarios 2 and 3); an external provider is reached over HTTPS.
  assert.equal(envOf(3).get("OIDC_ALLOW_INSECURE_HTTP"), "true");
  assert.equal(envOf(4).get("OIDC_ALLOW_INSECURE_HTTP"), "false");
  assert.doesNotMatch(composeCode, /SESSION_COOKIE_SECURE: "(true|false)"/);
});

test("every variable the compose uses is declared in an env file, and every declared one is used", () => {
  const used = usedIn(composeCode);
  const declared = new Set(
    COMPOSE_SCENARIOS.flatMap((n) => [...envOf(n).keys()]),
  );
  for (const key of used) {
    assert.ok(declared.has(key), `${key} is used but declared nowhere`);
  }
  for (const n of COMPOSE_SCENARIOS) {
    for (const key of envOf(n).keys()) {
      assert.ok(
        used.has(key) || COMPOSE_OWN_KEYS.has(key),
        `${key} is declared in ${SCENARIOS[n].env} but never used`,
      );
    }
  }
});

test("every env file declares every variable the compose requires, so a missing one is a hole in the example", () => {
  const required = requiredIn(composeCode);
  for (const n of COMPOSE_SCENARIOS) {
    for (const key of required) {
      assert.ok(envOf(n).has(key), `${SCENARIOS[n].env} lacks ${key}`);
    }
  }
});

test("the env files that run the bundled Keycloak declare every variable its services use, and the external one runs none", () => {
  const keycloakVars = new Set([
    ...usedIn(serviceBlock(composeCode, "keycloak")),
    ...usedIn(serviceBlock(composeCode, "keycloak-db")),
  ]);
  for (const n of [2, 3]) {
    const env = envOf(n);
    assert.equal(env.get("COMPOSE_PROFILES"), "keycloak", `scenario ${n}`);
    for (const key of keycloakVars) {
      assert.ok(env.has(key), `${SCENARIOS[n].env} lacks ${key}`);
    }
  }
  // Both Keycloak services sit in that profile and nothing else does.
  assert.equal(composeCode.match(/^\s+profiles: \[keycloak\]$/gm).length, 2);
  const external = envOf(4);
  assert.equal(external.has("COMPOSE_PROFILES"), false);
  assert.equal(external.get("CADDY_SITES"), "sites/edge.caddyfile");
  for (const key of external.keys()) {
    assert.doesNotMatch(key, /^(KC_|KEYCLOAK_)/, `${key} is Keycloak's`);
  }
  assert.doesNotMatch(external.get("OIDC_BACKCHANNEL_URL"), /keycloak:/);
  // The application waits for a healthy Keycloak (the cold start fails
  // without it), and the wait is optional so that the profile can leave the
  // service out.
  assert.match(
    serviceBlock(composeCode, "app"),
    /^\s+keycloak:\n\s+condition: service_healthy\n\s+required: false$/m,
  );
  assert.match(
    serviceBlock(composeCode, "caddy"),
    /^\s+keycloak:\n\s+condition: service_started\n\s+required: false$/m,
  );
});

test("each env file names the site file its scenario uses, and it exists", () => {
  for (const n of COMPOSE_SCENARIOS) {
    assert.equal(
      envOf(n).get("CADDY_SITES"),
      SCENARIOS[n].site,
      `scenario ${n}`,
    );
  }
  for (const site of SITE_FILES) {
    assert.ok(exists("caddy/" + site), `caddy/${site} is missing`);
  }
  // The workbench sets no CADDY_SITES, so the default has to be its file.
  assert.ok(
    caddyCode.trimEnd().endsWith(`import {$CADDY_SITES:${SCENARIOS[1].site}}`),
  );
  for (const n of [2, 3]) {
    assert.ok(exists(envOf(n).get("KEYCLOAK_REALM_FILE").slice(2)));
  }
});

test("the README puts each scenario's env file and site file on one row", () => {
  for (const [n, { env, site }] of Object.entries(SCENARIOS)) {
    const row = readme
      .split("\n")
      .find((line) => line.startsWith(`| ${n} |`) && line.includes(env));
    assert.ok(row, `no README row for scenario ${n}`);
    assert.ok(row.includes(site), `README row ${n} lacks ${site}`);
  }
});

test("the deployment guide puts each scenario's env file and site file on one row of its table", () => {
  for (const [n, { env, site }] of Object.entries(SCENARIOS)) {
    const row = guide
      .split("\n")
      .find((line) => line.startsWith(`| ${n} |`) && line.includes(env));
    assert.ok(row, `no deployment guide row for scenario ${n}`);
    assert.ok(row.includes(site), `deployment guide row ${n} lacks ${site}`);
  }
});

// The fenced blocks of one "## Scenario N: ..." section of the guide.
const scenarioBlocks = (n) => {
  const section = guide
    .split(/^## /m)
    .find((part) => part.startsWith(`Scenario ${n}:`));
  assert.ok(section, `no section for scenario ${n} in the deployment guide`);
  return [...section.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
};

test("each scenario's section carries a block that uses the env file that scenario runs, and no other", () => {
  for (const [n, { env }] of Object.entries(SCENARIOS)) {
    const blocks = scenarioBlocks(n);
    const uses = blocks.filter((block) => block.includes(env));
    assert.ok(uses.length >= 1, `no block of scenario ${n} names ${env}`);
    for (const [other, { env: otherEnv }] of Object.entries(SCENARIOS)) {
      if (other === n) continue;
      for (const block of blocks) {
        assert.ok(
          !block.includes(otherEnv),
          `a block of scenario ${n} names ${otherEnv}`,
        );
      }
    }
  }
  // The blocks that copy an env file to .env are the ones that overwrite it,
  // and they have to say so: running one twice against a live instance mints
  // new secrets for databases that still hold the old ones.
  for (const n of [1, 3, 4]) {
    const copy = scenarioBlocks(n).find((b) =>
      b.includes(`cp ${SCENARIOS[n].env} .env`),
    );
    assert.ok(copy, `scenario ${n} has no block that copies its env file`);
    assert.match(copy, /^# Overwrites an existing \.env/m, `scenario ${n}`);
  }
});

test("the production blocks generate every secret with hex and leave no other empty value", () => {
  for (const n of [3, 4]) {
    const block = scenarioBlocks(n).find((b) => b.includes("openssl"));
    assert.ok(block, `scenario ${n} has no generating block`);
    const filled = new Set(
      [...block.matchAll(/\^([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]),
    );
    for (const [key, value] of envOf(n)) {
      if (value !== "") continue;
      const yours =
        n === 4 && /^OIDC_(ISSUER_URL|CLIENT_ID|CLIENT_SECRET)$/.test(key);
      assert.equal(
        filled.has(key),
        !yours,
        `${key} of scenario ${n} is ${yours ? "the provider's and must stay empty" : "left empty by the block"}`,
      );
    }
    assert.doesNotMatch(block, /openssl rand -base64/);
  }
});

test("the README and the deployment guide document every variable of every env file", () => {
  for (const n of Object.keys(SCENARIOS)) {
    for (const key of envOf(n).keys()) {
      assert.ok(
        readme.includes(key) || guide.includes(key),
        `neither the README nor docs/deployment.md mentions ${key} of ${SCENARIOS[n].env}`,
      );
    }
  }
});

test("the deployment guide names every variable a production operator fills", () => {
  for (const n of [3, 4]) {
    for (const [key, value] of envOf(n)) {
      if (value === "") {
        assert.ok(guide.includes(key), `docs/deployment.md lacks ${key}`);
      }
    }
  }
});

test("the deployment guide names every bind-mount path of the compose", () => {
  const paths = new Set(
    [
      ...composeCode.matchAll(
        /\$\{HANDOUT_STATE_DIR:\?[^}]*\}\/([a-z][a-z0-9-]*):/g,
      ),
    ].map((match) => match[1]),
  );
  assert.equal(paths.size, 4);
  for (const path of paths) {
    assert.ok(
      guide.includes(`$HANDOUT_STATE_DIR/${path}`),
      `docs/deployment.md does not mention $HANDOUT_STATE_DIR/${path}`,
    );
  }
  assert.doesNotMatch(composeCode, /^volumes:/m, "named volumes are back");
});

test("Keycloak's health check has a start period, and the guide names the repair for an empty administrator", () => {
  assert.match(
    serviceBlock(composeCode, "keycloak"),
    /^\s+start_period: \d+s$/m,
  );
  // The compose cannot require these (scenario 4 has no Keycloak), so the
  // guide has to say what an empty value does and how to get out of it.
  assert.match(guide, /rm -rf "\$HANDOUT_STATE_DIR\/keycloak-db"/);
  assert.match(guide, /KC_BOOTSTRAP_ADMIN_PASSWORD/);
});

test("the deployment guide names the Compose version that required: false needs", () => {
  assert.match(composeCode, /required: false/);
  assert.match(guide, /Compose 2\.20\.0 or later/);
});

test("the ask path is the same string in the application and in the one Caddyfile", () => {
  assert.ok(
    caddyCode.includes(`ask http://{$APP_HOST}:{$APP_PORT}${TLS_CHECK_PATH}\n`),
  );
  const snippet = /^\(handout-app\) \{\n([\s\S]*?)\n\}$/m.exec(caddyCode);
  assert.ok(snippet, "the handout-app snippet is missing");
  assert.ok(snippet[1].includes(`handle ${TLS_CHECK_PATH}*`));
  assert.ok(snippet[1].includes("reverse_proxy {$APP_HOST}:{$APP_PORT}"));
});

test("every site block that fronts the application imports the snippet that denies the ask path, and none proxies to it by hand", () => {
  for (const site of SITE_FILES.concat("sites/edge-keycloak.caddyfile")) {
    const code = withoutComments(read("caddy/" + site));
    assert.doesNotMatch(code, /reverse_proxy \{\$APP_HOST\}/, site);
    assert.doesNotMatch(code, /tls-check/, site);
    for (const block of siteBlocks(code)) {
      if (block.address === "{$KEYCLOAK_DOMAIN}") continue;
      assert.match(block.text, /^\s+import handout-app$/m, block.address);
    }
  }
  // Every site file has at least one block of its own or imports one.
  assert.equal(siteBlocks(withoutComments(siteOf(1))).length, 1);
  assert.equal(siteBlocks(withoutComments(siteOf(4))).length, 2);
  assert.match(withoutComments(siteOf(3)), /^import edge\.caddyfile$/m);
});

test("the shared part carries trusted_proxies once, and no site file repeats it", () => {
  assert.equal(
    caddyCode.match(/^\s+trusted_proxies static private_ranges$/gm).length,
    1,
  );
  for (const site of SITE_FILES) {
    assert.doesNotMatch(read("caddy/" + site), /trusted_proxies\s+\S/, site);
  }
});

test("on-demand TLS is on the hostname pattern only, and the Keycloak block is automated explicitly", () => {
  const edge = withoutComments(siteOf(4));
  assert.equal(edge.match(/^\s+on_demand$/gm).length, 1);
  const pattern = siteBlocks(edge).find((b) => b.address.startsWith("*."));
  assert.ok(pattern.text.includes("on_demand"));
  const named = siteBlocks(edge).find((b) => b.address === "{$HANDOUT_DOMAIN}");
  assert.ok(!named.text.includes("on_demand"));
  // No other site file, and no shared part, turns it on.
  for (const other of [
    siteOf(1),
    read("caddy/sites/edge-keycloak.caddyfile"),
  ]) {
    assert.doesNotMatch(withoutComments(other), /on_demand\b/);
  }
  assert.doesNotMatch(caddyCode.replace(/on_demand_tls/g, ""), /on_demand\b/);
  const keycloak = siteBlocks(
    withoutComments(read("caddy/sites/edge-keycloak.caddyfile")),
  ).find((b) => b.address === "{$KEYCLOAK_DOMAIN}");
  // force_automate is an argument of the tls directive, not a subdirective;
  // the block form fails to adapt.
  assert.match(keycloak.text, /^\ttls force_automate$/m);
  assert.doesNotMatch(keycloak.text, /tls \{/);
  assert.ok(!keycloak.text.includes("on_demand"));
});

test("the workbench and the trial serve one bare-port site, with no TLS of its own", () => {
  const [block] = siteBlocks(withoutComments(siteOf(1)));
  assert.equal(block.address, "{$CADDY_SITE_ADDRESS}");
  assert.doesNotMatch(block.text, /\btls\b/);
  assert.equal(SCENARIOS[1].site, SCENARIOS[2].site);
});

test("the production realm carries no users and no literal secret, and the fixture keeps its users", () => {
  const production = JSON.parse(read("keycloak/realm.production.json"));
  assert.equal(production.users, undefined);
  assert.equal(production.sslRequired, "external");
  const client = production.clients.find((c) => c.clientId === "handout-web");
  assert.ok(client.secret.startsWith("${"));
  assert.equal(
    envOf(3).get("KEYCLOAK_REALM_FILE"),
    "./keycloak/realm.production.json",
  );
  assert.equal(envOf(3).get("OIDC_CLIENT_ID"), client.clientId);
  assert.equal(JSON.parse(read("keycloak/realm.json")).users.length, 2);
});

test("scenario 3 derives Keycloak's public URL and the issuer from one name", () => {
  const env = envOf(3);
  assert.equal(env.get("KC_HOSTNAME"), "https://${KEYCLOAK_DOMAIN}");
  assert.equal(
    env.get("OIDC_ISSUER_URL"),
    "https://${KEYCLOAK_DOMAIN}/realms/handout",
  );
});

test("CI validates the Caddyfile with every site file", () => {
  for (const site of SITE_FILES) {
    assert.ok(
      ci.includes(site),
      `.github/workflows/ci.yml does not validate ${site}`,
    );
  }
});
