// The three scenarios of docs/deployment.md and the development loop of the
// README share one caddy/Caddyfile and one compose.yaml (docs/adr/0032). What
// differs is a file of site blocks under caddy/sites/ and an env file: one per
// scenario under env/, and .env.example at the root for the development loop.
// These checks hold the shared parts together, hold each env file complete
// against the compose, and hold the deployment guide and the README to what the
// files actually need. Files are read as text, for the reason
// test/helpers/deployment-files.js gives.

import test from "node:test";
import assert from "node:assert/strict";
import { TLS_CHECK_PATH } from "../src/routes/operations.js";
import { CONFIG_VARIABLES } from "../src/config.js";
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

// The scenarios of docs/deployment.md, each with the one env file and the one
// site file it is run with.
const SCENARIOS = {
  1: { env: "env/local.env.example", site: "sites/local.caddyfile" },
  2: {
    env: "env/production.env.example",
    site: "sites/edge-keycloak.caddyfile",
  },
  3: {
    env: "env/production-external-idp.env.example",
    site: "sites/edge.caddyfile",
  },
};
const COMPOSE_SCENARIOS = [1, 2, 3];
const envOf = (n) => parseEnv(read(SCENARIOS[n].env));
const siteOf = (n) => read("caddy/" + SCENARIOS[n].site);
const SITE_FILES = [...new Set(Object.values(SCENARIOS).map((s) => s.site))];

// The development loop: the application runs from source and compose brings up
// the services, both from the one .env.example at the root. Its file carries
// the application's variables (and the tests') beside compose's, so those are
// not compose's to use.
const DEV_ENV = ".env.example";
const dev = parseEnv(read(DEV_ENV));
const APP_KEYS = new Set([...CONFIG_VARIABLES, "POSTGRES_URL"]);
// Every env file compose is run with.
const COMPOSE_ENVS = [
  ...COMPOSE_SCENARIOS.map((n) => ({ name: SCENARIOS[n].env, env: envOf(n) })),
  { name: DEV_ENV, env: dev },
];

// Keys an env file sets for compose itself and the compose text never names.
const COMPOSE_OWN_KEYS = new Set(["COMPOSE_PROFILES", "COMPOSE_FILE"]);

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
  assert.equal(envOf(1).get("SESSION_COOKIE_SECURE"), "false");
  assert.equal(dev.get("SESSION_COOKIE_SECURE"), "false");
  for (const n of [2, 3]) {
    assert.equal(
      envOf(n).get("SESSION_COOKIE_SECURE"),
      "true",
      `scenario ${n}`,
    );
  }
  // Plain HTTP against the provider is only for the hop inside the compose
  // network (scenarios 1 and 2, and the loop); an external provider is reached over HTTPS.
  assert.equal(envOf(2).get("OIDC_ALLOW_INSECURE_HTTP"), "true");
  assert.equal(envOf(3).get("OIDC_ALLOW_INSECURE_HTTP"), "false");
  assert.equal(dev.get("OIDC_ALLOW_INSECURE_HTTP"), "true");
  assert.doesNotMatch(composeCode, /SESSION_COOKIE_SECURE: "(true|false)"/);
});

test("every variable the compose uses is declared in an env file, and every declared one is used", () => {
  const used = usedIn(composeCode);
  const declared = new Set(COMPOSE_ENVS.flatMap(({ env }) => [...env.keys()]));
  for (const key of used) {
    assert.ok(declared.has(key), `${key} is used but declared nowhere`);
  }
  for (const { name, env } of COMPOSE_ENVS) {
    for (const key of env.keys()) {
      // The development loop's file also carries the application's variables.
      const application = name === DEV_ENV && APP_KEYS.has(key);
      assert.ok(
        used.has(key) || COMPOSE_OWN_KEYS.has(key) || application,
        `${key} is declared in ${name} but never used`,
      );
    }
  }
});

test("every env file declares every variable the compose requires, so a missing one is a hole in the example", () => {
  const required = requiredIn(composeCode);
  for (const { name, env } of COMPOSE_ENVS) {
    for (const key of required) {
      assert.ok(env.has(key), `${name} lacks ${key}`);
    }
  }
});

test("the env files that run the bundled Keycloak declare every variable its services use, and the external one runs none", () => {
  const keycloakVars = new Set([
    ...usedIn(serviceBlock(composeCode, "keycloak")),
    ...usedIn(serviceBlock(composeCode, "keycloak-db")),
  ]);
  for (const { name, env } of COMPOSE_ENVS) {
    if (name === SCENARIOS[3].env) continue;
    assert.equal(env.get("COMPOSE_PROFILES"), "keycloak", name);
    for (const key of keycloakVars) {
      assert.ok(env.has(key), `${name} lacks ${key}`);
    }
  }
  // Both Keycloak services sit in that profile and nothing else does.
  assert.equal(composeCode.match(/^\s+profiles: \[keycloak\]$/gm).length, 2);
  const external = envOf(3);
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
  // A setup that sets no CADDY_SITES (a workbench with its own proxy in front
  // of this Caddy) gets the default, so the default has to be the local file.
  assert.ok(
    caddyCode.trimEnd().endsWith(`import {$CADDY_SITES:${SCENARIOS[1].site}}`),
  );
  // The development loop serves the same file as the trial.
  assert.equal(dev.get("CADDY_SITES"), SCENARIOS[1].site);
  for (const { env } of COMPOSE_ENVS.filter(({ env }) =>
    env.has("KEYCLOAK_REALM_FILE"),
  )) {
    assert.ok(exists(env.get("KEYCLOAK_REALM_FILE").slice(2)));
  }
});

test("the README points at each scenario's env file", () => {
  for (const { env } of Object.values(SCENARIOS)) {
    assert.ok(readme.includes(`(${env})`), `README does not link ${env}`);
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
  for (const n of [2, 3]) {
    const copy = scenarioBlocks(n).find((b) =>
      b.includes(`cp ${SCENARIOS[n].env} .env`),
    );
    assert.ok(copy, `scenario ${n} has no block that copies its env file`);
    assert.match(copy, /^# Overwrites an existing \.env/m, `scenario ${n}`);
  }
});

test("the production blocks generate every secret with hex and leave no other empty value", () => {
  for (const n of [2, 3]) {
    const block = scenarioBlocks(n).find((b) => b.includes("openssl"));
    assert.ok(block, `scenario ${n} has no generating block`);
    const filled = new Set(
      [...block.matchAll(/\^([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]),
    );
    for (const [key, value] of envOf(n)) {
      if (value !== "") continue;
      const yours =
        n === 3 && /^OIDC_(ISSUER_URL|CLIENT_ID|CLIENT_SECRET)$/.test(key);
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
  for (const { name, env } of COMPOSE_ENVS) {
    for (const key of env.keys()) {
      assert.ok(
        readme.includes(key) || guide.includes(key),
        `neither the README nor docs/deployment.md mentions ${key} of ${name}`,
      );
    }
  }
});

test("the deployment guide names every variable a production operator fills", () => {
  for (const n of [2, 3]) {
    for (const [key, value] of envOf(n)) {
      if (value === "") {
        assert.ok(guide.includes(key), `docs/deployment.md lacks ${key}`);
      }
    }
  }
});

test("the artifacts are the one bind mount, the databases and Caddy's store are named volumes, and the guide names each", () => {
  // The only host path is the artifacts directory, from one variable.
  const binds = [
    ...composeCode.matchAll(
      /^\s+- "?(\$\{HANDOUT_[A-Z_]+_DIR:\?[^}]*\})[^:\n]*:\/data"?$/gm,
    ),
  ].map((match) => match[1]);
  assert.equal(binds.length, 2, "data-owner and app mount the artifacts");
  for (const bind of binds) {
    assert.match(bind, /^\$\{HANDOUT_ARTIFACTS_DIR:\?/);
  }
  assert.doesNotMatch(composeCode, /HANDOUT_STATE_DIR/);
  // A bind mount of a database is refused by PostgreSQL on Docker Desktop
  // (docs/adr/0033), so a database and Caddy's store must be volumes.
  const volumes = new Map([
    ["postgres", "postgres-data"],
    ["keycloak-db", "keycloak-db-data"],
    ["caddy", "caddy-data"],
  ]);
  for (const [service, volume] of volumes) {
    assert.match(
      serviceBlock(composeCode, service),
      new RegExp(`^\\s+- ${volume}:/`, "m"),
      `${service} does not mount the named volume ${volume}`,
    );
    assert.match(
      composeCode,
      new RegExp(`^volumes:[\\s\\S]*^  ${volume}:$`, "m"),
    );
    assert.ok(
      guide.includes(`handout_${volume}`),
      `docs/deployment.md does not name the volume handout_${volume}`,
    );
  }
  assert.ok(guide.includes("`HANDOUT_ARTIFACTS_DIR`"));
});

test("the deployment guide names the four things that hold state and what losing Caddy's store does and does not cost", () => {
  assert.match(guide, /### What must persist\n/);
  assert.doesNotMatch(guide, /pg_dump|pg_restore/);
  assert.match(guide, /obtained again at startup/);
  assert.match(guide, /only when a request for that\s+address next arrives/);
  assert.match(guide, /faster than\s+the allowance refills/);
  assert.doesNotMatch(guide, /every\s+certificate is requested again at once/);
});

test("the guide and the ADR agree on the certificate allowance", () => {
  assert.match(guide, /49 or 48 a week/);
  assert.match(guide, /refills over the window/);
  const adr = read(
    "docs/adr/0029-a-certificate-per-address-obtained-on-demand.md",
  );
  assert.match(adr, /49 or 48 new handouts a week/);
  assert.doesNotMatch(adr, /50 new handouts a week/);
});

test("the guide names OpenSSL as a prerequisite of the production scenarios", () => {
  assert.match(guide, /\*\*For the production scenarios, 2 and 3: OpenSSL\*\*/);
});

test("Keycloak's health check has a start period, and the guide names the repair for an empty administrator", () => {
  assert.match(
    serviceBlock(composeCode, "keycloak"),
    /^\s+start_period: \d+s$/m,
  );
  // The compose cannot require these (scenario 3 has no Keycloak), so the
  // guide has to say what an empty value does and how to get out of it.
  assert.match(guide, /docker volume rm handout_keycloak-db-data/);
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
  assert.equal(siteBlocks(withoutComments(siteOf(3))).length, 2);
  assert.match(withoutComments(siteOf(2)), /^import edge\.caddyfile$/m);
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
  const edge = withoutComments(siteOf(3));
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

test("the trial, the loop and any proxied setup serve one bare-port site, with no TLS of its own", () => {
  const [block] = siteBlocks(withoutComments(siteOf(1)));
  assert.equal(block.address, "{$CADDY_SITE_ADDRESS}");
  assert.doesNotMatch(block.text, /\btls\b/);
  assert.match(dev.get("CADDY_SITE_ADDRESS"), /^:\d+$/);
});

test("the production realm carries no users and no literal secret, and the fixture keeps its users", () => {
  const production = JSON.parse(read("keycloak/realm.production.json"));
  assert.equal(production.users, undefined);
  assert.equal(production.sslRequired, "external");
  const client = production.clients.find((c) => c.clientId === "handout-web");
  assert.ok(client.secret.startsWith("${"));
  assert.equal(
    envOf(2).get("KEYCLOAK_REALM_FILE"),
    "./keycloak/realm.production.json",
  );
  assert.equal(envOf(2).get("OIDC_CLIENT_ID"), client.clientId);
  assert.equal(JSON.parse(read("keycloak/realm.json")).users.length, 2);
});

test("scenario 2 derives Keycloak's public URL and the issuer from one name", () => {
  const env = envOf(2);
  assert.equal(env.get("KC_HOSTNAME"), "https://${KEYCLOAK_DOMAIN}");
  assert.equal(
    env.get("OIDC_ISSUER_URL"),
    "https://${KEYCLOAK_DOMAIN}/realms/handout",
  );
});

test("CI validates the Caddyfile with every site file, and with no CADDY_SITES at all", () => {
  for (const site of SITE_FILES) {
    assert.ok(
      ci.includes(site),
      `.github/workflows/ci.yml does not validate ${site}`,
    );
  }
  // The case a proxied setup (a workbench) is in: the default import, with
  // nothing chosen. A one-line validate call, so the line can be inspected.
  const bare = ci
    .split("\n")
    .filter((line) => /^\s+validate -e CADDY_SITE_ADDRESS=/.test(line));
  assert.equal(bare.length, 1, "no validation without CADDY_SITES");
  assert.doesNotMatch(bare[0], /CADDY_SITES/);
});

// The README's development loop is three lines and nothing to fill; the
// Monoceros chapter's block is the four-line flow. Each file is complete.
const readmeBlocks = [...readme.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map(
  (m) => m[1],
);

test("the README's development loop is three lines, and .env.example leaves nothing to fill", () => {
  assert.ok(
    readmeBlocks.includes("cp .env.example .env\nnpm install\nnpm run dev\n"),
  );
  for (const [key, value] of dev) {
    assert.notEqual(value, "", `${key} is empty in ${DEV_ENV}`);
  }
});

test("the workbench chapter gives its commands in the order they are run", () => {
  // The commands come in the order they are run, each beside the step it
  // belongs to: init writes the yml, so it cannot come after the edit.
  const init = readme.indexOf("monoceros init handout ");
  const edit = readme.indexOf("projects/handout-app/caddy:/etc/caddy:ro");
  const apply = readme.indexOf("monoceros apply handout");
  const run = readme.indexOf(
    "monoceros run handout --in=projects/handout-app -- npm run dev:monoceros",
  );
  assert.ok(init > 0 && edit > init, "the yml edit comes before init");
  assert.ok(apply > edit, "apply comes before the yml edit");
  assert.ok(run > apply, "the run command comes before apply");
  // `monoceros run` has no shell in between, so nothing is chained after `--`.
  assert.doesNotMatch(readme, /--[^\n]*&&/);
  assert.doesNotMatch(readme, /sed -i/);
});

test("dev:monoceros copies the workbench's .env without clobbering one and does not hardcode the app", () => {
  assert.match(
    read("package.json"),
    /"dev:monoceros": "sh scripts\/dev-monoceros\.sh"/,
  );
  const script = read("scripts/dev-monoceros.sh");
  assert.match(script, /if \[ -e \.env \]; then/);
  assert.match(script, /cp \.env\.monoceros\.example \.env/);
  assert.doesNotMatch(script, /cp -f|cp .*-f /);
  assert.match(script, /monoceros-ctl start "\$\(basename "\$PWD"\)"/);
  assert.doesNotMatch(script, /handout-app/);
});

test(".env.monoceros.example leaves nothing to fill and differs from .env.example in exactly four values", () => {
  const workbench = parseEnv(read(".env.monoceros.example"));
  for (const [key, value] of workbench) {
    assert.notEqual(value, "", `${key} is empty in .env.monoceros.example`);
  }
  // The workbench reaches the services by hostname, not through published ports.
  const DIFFERENT = new Set([
    "DATABASE_URL",
    "POSTGRES_URL",
    "OIDC_ISSUER_URL",
    "OIDC_BACKCHANNEL_URL",
  ]);
  assert.deepEqual([...workbench.keys()].sort(), [...APP_KEYS].sort());
  for (const key of APP_KEYS) {
    if (DIFFERENT.has(key)) {
      assert.notEqual(
        workbench.get(key),
        dev.get(key),
        `${key} must differ from ${DEV_ENV}`,
      );
    } else {
      assert.equal(
        workbench.get(key),
        dev.get(key),
        `${key} must match ${DEV_ENV}`,
      );
    }
  }
});

test(".env.example is one file for both readers: compose's variables and the application's twelve", () => {
  for (const key of CONFIG_VARIABLES) {
    assert.ok(dev.has(key), `${DEV_ENV} lacks ${key}`);
  }
  assert.ok(dev.has("POSTGRES_URL"));
  // npm start reads the very .env that compose is given with --env-file.
  assert.match(read("package.json"), /"start": "node --env-file=\.env /);
  assert.match(read(DEV_ENV), /one file/i);
});

test("npm run dev starts the services and then the application, and never the app service", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts.dev, "sh scripts/dev.sh");
  assert.equal(scripts["dev:down"], "docker compose --env-file .env down");
  const script = withoutComments(read("scripts/dev.sh"));
  const calls = script.match(/^docker compose .*$/gm);
  assert.deepEqual(calls, [
    "docker compose --env-file .env up -d --wait postgres keycloak",
    "docker compose --env-file .env up -d --no-deps caddy",
  ]);
  // The application is the last thing, in the script's own process, so that
  // Ctrl+C ends it and leaves the detached containers alone.
  assert.match(script.trimEnd(), /^exec npm start$/m);
  assert.ok(script.trimEnd().endsWith("exec npm start"));
});

test("no deployment scenario publishes PostgreSQL's port or reads the development override", () => {
  assert.doesNotMatch(serviceBlock(composeCode, "postgres"), /^\s+ports:/m);
  assert.doesNotMatch(composeCode, /5432:5432/);
  for (const n of COMPOSE_SCENARIOS) {
    assert.equal(envOf(n).has("COMPOSE_FILE"), false, `scenario ${n}`);
  }
});

test("the development loop runs the application from source and everything else from the compose", () => {
  // Caddy reaches the application on the host, and the name resolves on Linux.
  assert.equal(dev.get("APP_HOST"), "host.docker.internal");
  assert.match(
    serviceBlock(composeCode, "caddy"),
    /^\s+- "host\.docker\.internal:host-gateway"$/m,
  );
  assert.match(composeCode, /APP_HOST: \$\{APP_HOST:-app\}/);
  // PostgreSQL is published on the host's loopback only, by the loop's own
  // override file and not by compose.yaml, and the loop's connection strings
  // say where.
  assert.equal(dev.get("COMPOSE_FILE"), "compose.yaml:compose.dev.yaml");
  assert.match(
    withoutComments(read("compose.dev.yaml")),
    /^services:\n {2}postgres:\n {4}ports:\n {6}- "127\.0\.0\.1:5432:5432"\n$/,
  );
  assert.match(dev.get("DATABASE_URL"), /@localhost:5432\//);
  assert.match(dev.get("POSTGRES_URL"), /@localhost:5432\//);
  // The application listens where the Caddy container can reach it.
  assert.equal(dev.get("BIND_ADDRESS"), "0.0.0.0");
});
