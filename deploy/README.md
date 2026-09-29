# Running Handout on your own server

Handout turns a finished artifact into a durable, optionally password protected
address on your own infrastructure.

A public instance needs a domain, two DNS records, Docker, and the files in
this directory. This document covers running one with the compose file next to
it, and what an environment must provide if you build your own deployment
instead: everything below is enough to do that without the compose file, and
the last part says what a proxy of your own has to do.

## What the environment must bring

- **A domain**, and two DNS records pointing at the machine:
  `handout.example.com` and `*.handout.example.com`. The identity provider's
  `id.handout.example.com` is covered by the wildcard record, which is why two
  are enough.
- **Ports 80 and 443 reachable from the internet.** Without them no certificate
  is ever issued.
- **Docker with compose.**

That is all. No access to the DNS zone, no API token, no certificate file that
anybody touches: Caddy obtains a certificate for every name it serves, by
itself, from Let's Encrypt.

## The files

Copy this directory to the machine, copy `.env.example` to `.env` next to
`compose.yaml`, and fill it. The `.env` is a file on the target machine. Whether
a person writes it or a pipeline renders it from its secret store is the same
file and the same compose; neither is presupposed. Compose refuses to start
and names the value that is missing.

## Every variable

The deployment's nine, in `.env.example`:

| Variable | What it is for |
| --- | --- |
| `HANDOUT_DOMAIN` | the domain the publisher interface answers on, e.g. `handout.example.com`; a handout is `<address>.<this>` |
| `KEYCLOAK_DOMAIN` | the name the identity provider answers on, e.g. `id.handout.example.com` |
| `ACME_EMAIL` | where Let's Encrypt sends expiry and policy notices |
| `POSTGRES_PASSWORD` | the password of the application's database. It ends up inside a connection URL, so it must not contain characters with a special meaning there: `@`, `/`, `:` and `#` in particular |
| `KC_DB_PASSWORD` | the password of Keycloak's own database |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | the first administrator of the identity provider's console |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | that administrator's password, to be changed at the first sign-in |
| `OIDC_CLIENT_SECRET` | the secret of the `handout-web` client, read by the realm import and by the application |
| `SESSION_SECRET` | signs the session cookie of the application |

The Caddyfile in `caddy/` also reads `APP_HOST`, `APP_PORT`,
`KEYCLOAK_HOST` and `KEYCLOAK_PORT`; the compose sets them to the service names
and ports of the containers, and there is nothing to choose.

The application's own twelve are in the
[configuration table](../README.md#configuration) of the main README, and the
compose fills them. Three differ from the [local compose](../compose.yaml), for
a reason each:

- `SESSION_COOKIE_SECURE` is `true`, because every request the browser makes is
  HTTPS here.
- `OIDC_ALLOW_INSECURE_HTTP` stays `true`. The one plain-HTTP request in this
  deployment is the application's hop to Keycloak inside the compose network
  (`OIDC_BACKCHANNEL_URL`, `../docs/adr/0005-oidc-two-origins-and-stateless-session.md`),
  which never leaves the host. Set it to `false` when your provider is reachable
  over HTTPS from the application.
- `OIDC_ISSUER_URL` is `https://<KEYCLOAK_DOMAIN>/realms/handout`, the identity
  provider under its own public name.

## The first start

    docker compose up -d

The application runs its migrations, Keycloak imports the realm, and Caddy
obtains the certificates for the two names it knows, the publisher origin and
the identity provider. Then sign in to the admin console at
`https://id.handout.example.com` with the bootstrap administrator, change that
password, and create the publishers by hand in the realm `handout`. There is no
self-registration and no mail: a publisher gets a temporary password set in the
console.

The realm has `sslRequired` set to `external`, not `all`. Keycloak's `all`
demands TLS from every address, including the application's back-channel hop
over the private compose network, and would refuse every token request.

## The realm file is imported once

Keycloak skips the import when the realm already exists, and this deployment
keeps Keycloak's database in a volume. So editing `keycloak/realm.json` later
changes nothing, and a later change of `HANDOUT_DOMAIN` means changing the
client's redirect URI and post-logout URI in the admin console by hand.

## What must persist, and what to back up

Four volumes, by the names in `compose.yaml`:

- `handout-data`: the published artifacts.
- `postgres-data`: the application's database, with the handouts, their
  addresses and their passwords.
- `keycloak-db-data`: Keycloak's database, with the publishers' accounts.
- `caddy-data`: Caddy's certificate store. Losing it means every certificate is
  issued again, and that does count against Let's Encrypt's weekly limit (see
  below).

Back up the first three. The fourth is worth keeping for the reason given.

## A newer version

Change the tag in `compose.yaml` (on `data-owner` and on `app`), then:

    docker compose pull
    docker compose up -d

Migrations run at start and have no way back, so take a backup of the database
first. How versions are cut is in
`../docs/adr/0027-the-version-is-a-git-tag.md`.

## Three things that look like faults and are not

- **The first call to a fresh address takes about a second longer.** The
  certificate is being obtained in that moment.
- **Ports 80 and 443 must be reachable from outside**, or no certificate is
  ever issued and every address fails at the handshake.
- **The limit is 50 new handouts per week, not 50 handouts.** Let's Encrypt
  issues 50 new certificates per registered domain per 7 days (checked on
  2026-09-28). Renewals are exempt, so a handout that exists costs nothing more
  however many there are and however long they live. A raise can be applied for
  at Let's Encrypt through a form.

## What a change of identity provider costs

Whoever starts with the shipped Keycloak and later moves to a company provider
gets a new identifier for every person, and a handout's owner is exactly that
identifier: the handouts published under Keycloak would be left without an
owner. `../docs/adr/0017-the-owners-email-is-recorded-as-a-note.md` foresaw this
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
- **Keep that path unreachable from outside**, as both Caddyfiles do (this directory's and the local one in `../caddy/`).

The application itself is one container that needs nothing but its twelve
variables, a PostgreSQL, and a volume for the data directory. What must persist
is the list above. The container answers `GET /.handout/health` with `200` when
it can reach its database, and stops on `SIGTERM`.

Why the deployment is a second example and not a parameterised first one:
`../docs/adr/0030-the-production-deployment-is-a-second-example.md`. Why a
certificate per address, and what it costs:
`../docs/adr/0029-a-certificate-per-address-obtained-on-demand.md`.
