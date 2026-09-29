# Running Handout on your own server

Handout turns a finished artifact into a durable, optionally password protected
address on your own infrastructure.

A public instance needs a domain, two DNS records, Docker, and the files of
this repository. This document covers the two production scenarios of the
README's "Four ways to run it", both run with the `compose.yaml` at the
repository root, and what an environment must provide if you build your own
deployment instead: everything below is enough to do that without the compose
file, and the last part says what a proxy of your own has to do.

| # | Scenario | Env file | Caddy site file |
| --- | --- | --- | --- |
| 3 | Production with the bundled Keycloak | `env/3-production.env.example` | `caddy/sites/edge-keycloak.caddyfile` |
| 4 | Production with an identity provider you already have | `env/4-production-external-idp.env.example` | `caddy/sites/edge.caddyfile` |

Everything below applies to both unless it says which. The one difference is the
identity provider: scenario 3 runs Keycloak next to the application, scenario 4
runs none and points the application at yours.

## What the environment must bring

- **A domain**, and two DNS records pointing at the machine:
  `handout.example.com` and `*.handout.example.com`. In scenario 3 the bundled
  Keycloak's `id.handout.example.com` is covered by the wildcard record, which is
  why two are enough.
- **Ports 80 and 443 reachable from the internet.** Without them no certificate
  is ever issued.
- **Docker with Compose 2.20.0 or later** (`docker compose version`). The
  compose file makes the application's wait for Keycloak optional with
  `depends_on … required: false`, so that scenario 4 can leave Keycloak out; that
  keyword is unknown to older versions, which refuse the whole file.
- **Scenario 4 only: an identity provider** that speaks OIDC, with a
  confidential client registered for Handout: redirect URI
  `https://handout.example.com/auth/callback`, post-logout redirect URI
  `https://handout.example.com/` (your own domain in both).

That is all. No access to the DNS zone, no API token, no certificate file that
anybody touches: Caddy obtains a certificate for every name it serves, by
itself, from Let's Encrypt.

## The files

Clone the repository to the machine (or copy it), copy the env file of your
scenario to `.env` at its root, and fill every empty value. The `.env` is a
file on the target machine. Whether a person writes it or a pipeline renders it
from its secret store is the same file and the same compose; neither is
presupposed. The lines that already carry a value are what the scenario is;
change one only if you know why. Compose refuses to start and names the
required value that is missing.

## Every variable you fill

The empty values of the env files. Each is required, and the rest of the file is
described in the README's "Configuration".

| Variable | Scenarios | What it is for |
| --- | --- | --- |
| `HANDOUT_DOMAIN` | 3, 4 | the domain the publisher interface answers on, e.g. `handout.example.com`; a handout is `<address>.<this>` |
| `KEYCLOAK_DOMAIN` | 3 | the name the identity provider answers on, e.g. `id.handout.example.com`; the env file derives `KC_HOSTNAME` and `OIDC_ISSUER_URL` from it |
| `ACME_EMAIL` | 3, 4 | where Let's Encrypt sends expiry and policy notices |
| `HANDOUT_STATE_DIR` | 3, 4 | the one directory that holds everything that must survive, e.g. `/srv/handout` (see "What must persist") |
| `POSTGRES_PASSWORD` | 3, 4 | the password of the application's database. It ends up inside a connection URL, so it must not contain characters with a special meaning there: `@`, `/`, `:` and `#` in particular |
| `KC_DB_PASSWORD` | 3 | the password of Keycloak's own database |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | 3 | the temporary administrator of the identity provider's console, used once (see the first start) |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | 3 | that account's password |
| `OIDC_CLIENT_SECRET` | 3, 4 | the secret of the client: in scenario 3 you choose it, and the realm import and the application both read it; in scenario 4 it is the one your provider issued |
| `OIDC_ISSUER_URL` | 4 | your provider's issuer as tokens carry it, e.g. `https://login.example.com/realms/company` |
| `OIDC_CLIENT_ID` | 4 | the client id registered at your provider (scenario 3 fixes it to `handout-web`) |
| `SESSION_SECRET` | 3, 4 | signs the session cookie of the application |

Three of the application's twelve differ from the local trial, for a reason
each:

- `SESSION_COOKIE_SECURE` is `true`, because every request the browser makes is
  HTTPS here.
- `OIDC_ALLOW_INSECURE_HTTP` is `true` in scenario 3 and `false` in scenario 4.
  In scenario 3 the one plain-HTTP request is the application's hop to Keycloak
  inside the compose network (`OIDC_BACKCHANNEL_URL`, ADR 0005 in the
  repository's `docs/adr/`), which never leaves the host. A provider you did not
  install is reached over HTTPS from the application; if yours is not, set it to
  `true` knowingly.
- `OIDC_ISSUER_URL` is Keycloak under its own public name in scenario 3
  (`https://<KEYCLOAK_DOMAIN>/realms/handout`) and your provider's in scenario 4.
  `OIDC_BACKCHANNEL_URL` is the same realm as the application reaches it: inside
  the compose network in scenario 3, the issuer itself in scenario 4.

## The first start

    docker compose --env-file .env up -d

The application runs its migrations and Caddy obtains the certificates for the
names it knows: the publisher origin, and in scenario 3 the identity provider
as well. In scenario 3 Keycloak imports the realm too, and the application
waits until Keycloak is healthy, which on the very first start takes a while. In scenario 4 there is
nothing more to set up: sign in with your own provider.

### Scenario 3 only: the identity provider's first sign-in

Sign in to the admin console at
`https://id.handout.example.com` with the bootstrap administrator, once: create
a permanent administrator in the `master` realm, check that you can sign in with
it, and delete the bootstrap account. Only then create the publishers by hand in
the realm `handout`. There is no self-registration and no mail: a publisher gets
a temporary password set in the console.

`KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` stay in the
`.env` afterwards. **Fill both before the first start.** Compose cannot require
them (it also reads the Keycloak services in scenario 4, where they do not
exist), so an empty value is not refused: Keycloak starts, reports healthy,
imports the realm and creates no administrator, and nobody can ever sign in.
Keycloak reads the two variables only on the first start against an empty
database, so adding them afterwards changes nothing. The repair is to stop the
stack, delete `$HANDOUT_STATE_DIR/keycloak-db` (which discards Keycloak's state,
and it is empty of publishers at that point), fill the values and start again:

    docker compose --env-file .env down
    sudo rm -rf "$HANDOUT_STATE_DIR/keycloak-db"
    docker compose --env-file .env up -d

Keycloak's port 8080 is also published on the host's loopback interface as
`127.0.0.1:8081`. Production does not use it, and nothing outside the machine
can reach it; the same compose serves the local trial, which does.

The realm has `sslRequired` set to `external`, not `all`. Keycloak's `all`
demands TLS from every address, including the application's back-channel hop
over the private compose network, and would refuse every token request.

## Scenario 3 only: the realm file is imported once

Keycloak skips the import when the realm already exists, and this deployment
keeps Keycloak's database under `HANDOUT_STATE_DIR`. So editing
`keycloak/realm.production.json` later changes nothing, and a later change of `HANDOUT_DOMAIN` means changing the
client's redirect URI and post-logout URI in the admin console by hand.

## What must persist, and what to back up

Everything lives under one directory, `HANDOUT_STATE_DIR` (`/srv/handout` is a
sensible choice), so a backup is one `tar` or `rsync` of that path:

- `$HANDOUT_STATE_DIR/artifacts`: the published artifacts.
- `$HANDOUT_STATE_DIR/postgres`: the application's database, with the handouts,
  their addresses and their passwords.
- `$HANDOUT_STATE_DIR/keycloak-db`: Keycloak's database, with the publishers'
  accounts (scenario 3 only; in scenario 4 the directory does not exist).
- `$HANDOUT_STATE_DIR/caddy`: Caddy's certificate store, with every certificate
  issued so far (see the weekly limit below).

Without `caddy` every certificate is requested again at once, and past roughly
fifty active handouts that exceeds Let's Encrypt's weekly limit, so some
published addresses stay unreachable for days.

Nothing has to exist beforehand: Docker creates the directories on the first
start. To choose the owner and mode of the base directory yourself, create it
first:

    sudo mkdir -p /srv/handout

Start with an empty or missing directory for `postgres` (and `keycloak-db` in
scenario 3);
PostgreSQL refuses to initialise into a directory that already holds files.
Copy the database directories only while the stack is stopped, or use
`pg_dump` for a live backup.

The containers are named `handout-app`, `handout-caddy`, `handout-db`,
`handout-keycloak`, `handout-keycloak-db` and `handout-data-owner`; the two
Keycloak ones exist in scenario 3 only. The fixed names mean a second copy of this
deployment cannot run on the same host.

## A newer version

Change the tag in `compose.yaml` (on `data-owner` and on `app`), then:

    docker compose --env-file .env pull
    docker compose --env-file .env up -d

Migrations run at start and have no way back, so take a backup of the database
first. How versions are cut is in
ADR 0027 in the repository's `docs/adr/`.

## Three things that look like faults and are not

- **The first call to a fresh address takes about a second longer.** The
  certificate is being obtained in that moment.
- **Ports 80 and 443 must be reachable from outside**, or no certificate is
  ever issued and every address fails at the handshake.
- **The limit is at most 48 new handouts per week, not 50 handouts.** Let's
  Encrypt issues 50 new certificates per registered domain per 7 days (checked
  on 2026-09-28). The certificates for the publisher origin and for the identity
  provider come out of the same allowance, so the first week has at most 48
  left. Renewals are exempt (ARI), so a handout that exists costs nothing more
  however many there are and however long they live. A raise can be applied for
  at Let's Encrypt through a form.
- **The limit is per registered domain, not per hostname.** Every other service
  under the same registered domain that obtains Let's Encrypt certificates draws
  from the same 50. Whoever puts Handout under a domain already in use for other
  things has correspondingly fewer, and may hit the limit on the first day.

## What a change of identity provider costs

Whoever starts with the shipped Keycloak and later moves to a company provider
gets a new identifier for every person, and a handout's owner is exactly that
identifier: the handouts published under Keycloak would be left without an
owner. ADR 0017 in the repository's `docs/adr/` foresaw this
and keeps `owner_email` as a note, so the operator can pull the new identifiers
onto the old rows by hand, one deliberate step per person. Decide this before
starting with Keycloak, not after.

## Building your own deployment

What a proxy in front of the application must do:

- Pass `X-Forwarded-Host` and `X-Forwarded-Proto` through unchanged.
- Serve the publisher origin and every `<address>.<publisher origin>`.
- Obtain a certificate per hostname on demand, and ask
  `GET /.handout/tls-check?domain=<hostname>` first, treating a 2xx as yes and
  everything else as no. The answer is that the first label is an address that
  was ever issued, so a stranger cannot spend the weekly limit on made-up names.
  The publisher origin and the identity provider are not addresses; give them
  certificates the ordinary way, not through that question.
- **Keep that path unreachable from outside**, as the one `caddy/Caddyfile` does
  for every site file.

The application itself is one container that needs nothing but its twelve
variables, a PostgreSQL, and a directory for the data. What must persist
is the list above. The container answers `GET /.handout/health` with `200` when
it can reach its database, and stops on `SIGTERM`.

Why one Caddyfile and one compose serve all four scenarios, and not one set
each: ADR 0032 in the repository's `docs/adr/`. Why a certificate per address,
and what it costs: ADR 0029 there.
