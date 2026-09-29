# 32. One Caddyfile and one compose for four scenarios

Date: 2026-09-29

Status: accepted

Supersedes ADR 0030. That record is marked as superseded in its status line and
is otherwise left as it was written. (Until now a superseded decision was named
only in the body of the newer record, as ADR 0008 does for ADR 0002 on one
point. A whole record replaced is easier to spot at the top of the file it no
longer holds for, so its status line changes; that is the convention from here
on.) It also amends two earlier records, both left as they were written.
ADR 0028 said the shipped Keycloak holds no volume, so a recreated container
comes back with exactly what `keycloak/realm.json` says, and that PostgreSQL and
the data directory have volumes. After this change the trial runs Keycloak
against `keycloak-db` on a bind mount, the realm is imported once, and an edit
of `keycloak/realm.json` reaches the trial only after `docker compose down` and
deleting `state/`. There are no named volumes any more: everything is a bind
mount under `./state`. From ADR 0031 the sentence that the local compose
deliberately keeps named volumes and generated names is amended in the same way,
and everything else in it holds, the visible state directory and the fixed names
included.

## Context

ADR 0030 decided that the production deployment is a second, self-contained
example next to the local one, and rejected `import {$VAR}` because the two
shared no site block and a file made only of an import is a second Caddyfile
with an indirection in front. On its own terms that was right: at two
deployments, the duplication was two files.

There are now four scenarios that must work:

| # | Scenario | Caddy | Identity provider |
| --- | --- | --- | --- |
| 1 | Monoceros workbench, the development loop | behind the workbench proxy, no TLS, one site on a port | the workbench's own Keycloak |
| 2 | Local Docker, someone trying it out | the edge, no TLS, `handout.localhost:8080` and its wildcard | the bundled Keycloak |
| 3 | Production with the bundled Keycloak | the edge, a certificate per name | the bundled Keycloak |
| 4 | Production with an existing provider | the edge, a certificate per name | external, no Keycloak at all |

Four Caddyfiles and four composes would repeat the global block, the
`trusted_proxies` reasoning, the ask endpoint, the deny of the ask path and the
proxy body, and would repeat the service blocks of PostgreSQL, the application
and Caddy. Nobody keeps that in step by hand. At four the duplication costs more
than the indirection, which is the only thing that changed.

## Decision

**One `caddy/Caddyfile`** holds everything shared: the global block
(`trusted_proxies`, `on_demand_tls` with the ask endpoint at the application,
the ACME email), a snippet with the two things every site does (deny the ask
path from outside, proxy to the application) and, as its last line,
`import {$CADDY_SITES:sites/local.caddyfile}`.

**One file of site blocks per site shape under `caddy/sites/`.** The choice is
files and not variables because Caddy cannot make a site block vanish: an
address that is an empty variable fails with "server block without any key is
global configuration". Import paths resolve relative to the Caddyfile, not the
working directory, and the default names the workbench's file, so the
workbench needs no environment variable and no change on the host.

- `local.caddyfile` serves scenarios 1 and 2 together. They are the same file
  because nothing differs but a value: one block on a bare port, which the
  workbench proxy hands to Caddy in the first and compose sets to `:80`, behind
  the published 8080, in the second.
- `edge.caddyfile` is scenario 4: the publisher origin by name and the hostname
  pattern `*.<domain>` with on-demand TLS.
- `edge-keycloak.caddyfile` is scenario 3: it imports `edge.caddyfile` and adds
  the identity provider's block with `force_automate`.

`trusted_proxies static private_ranges` is in the shared part because it is
safe in every scenario: Caddy honours `X-Forwarded-*` only when the immediate
peer is inside the trusted ranges, and a client from the internet has a public
address, so its headers are replaced by the real values. On a local trial the
peer is inside a private range and a local client could set them, which is
irrelevant there.

**One `compose.yaml`** at the repository root replaces the old root file and
`deploy/compose.yaml`. What differs is an env file, one per scenario under
`env/`. Compose is run with `--env-file`, so the local trial is still one
command and copies nothing. The env file decides the Caddy site file, the
published host ports, whether Keycloak runs (`COMPOSE_PROFILES=keycloak` puts
`keycloak` and `keycloak-db` in and leaves them out of scenario 4), and where
the application finds its provider: the `OIDC_*` variables are read from the
env file instead of being wired to the `keycloak` service, so scenario 4 can
point them at anything.

**Two realm files remain.** `keycloak/realm.json` is the fixture: two
publishers with a known password, a literal secret, `sslRequired: none` and a
list of localhost redirect URIs. `keycloak/realm.production.json` has no users,
takes its secret and its domain from placeholders and has `sslRequired:
external`. They serve opposite purposes and share nothing but the client's name,
so they do not collapse. The env file names the one to import.

**The local trial keeps its state in `./state`**, beside the compose file and
out of git, and keeps the fixed container names. A trial wanting `/srv/handout`
is a claim that does not hold: it needs root, macOS has no such directory, and a
trial should leave nothing outside the clone. The fixed names cost nothing there
because two trials on one host already collide on port 8080. To start empty,
delete `state/`.

**One image and one version for all four**, as before, and a test that fails
when one file names another.

## Consequences

Whatever the scenarios share is written once, and a change to the ask path, the
deny or the proxy body is one edit. Adding a fifth scenario is a site file and an
env file.

What it costs, plainly:

- **Compose fills in every service of the file, also one a profile leaves out.**
  Checked in `compose-spec/compose-go` (`loader/loader.go`): interpolation runs
  over the whole model in `loadYamlFile`, and profiles are applied later in
  `ModelToProject`. A required variable (`:?`) that only Keycloak needs would
  stop scenario 4, so the Keycloak-only variables are optional in the compose
  and required by the env file of the scenario that runs Keycloak. A test keeps
  those env files complete. What it cannot catch at runtime: an empty
  `KC_BOOTSTRAP_ADMIN_*` makes Keycloak start healthy with no administrator, and
  since Keycloak reads them on the first start only, the repair is to delete
  `$HANDOUT_STATE_DIR/keycloak-db`. The env file and `docs/deployment.md` say so.
  An empty `KC_DB_PASSWORD` is caught, as PostgreSQL refuses to start without a
  password.
- **Docker Compose 2.20.0 or later is required.** The application still waits
  for a healthy Keycloak, which the first cold start needs, and Caddy for a
  started one. Both dependencies are `required: false`, so that scenario 4 can
  leave the service out through its profile: Compose then adds no edge instead of
  refusing the file. The keyword was introduced in 2.20.0 and older versions
  reject the whole file. `docs/deployment.md` names the version.
- **Keycloak's port is published on the host's loopback interface in every
  scenario**, since a port mapping cannot be switched off by a variable. The
  local trial needs it; in production nothing outside the machine can reach it.
- **The local trial's state is a bind mount,** where it used to be named
  volumes and `docker compose down -v` threw it away. On Linux the directories
  are owned by the container users, so deleting `state/` needs `sudo`.
- `ACME_EMAIL` is a variable of scenario 2 that means nothing there, because
  Caddy's `email` takes no empty value and the compose requires it where it
  matters.

The compose and the site files are checked against the real Caddy for all four
scenarios (CI validates each with its own environment), and the compose has not
been brought up against Docker in any of the three compose scenarios after this
change.
