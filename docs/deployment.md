# Running Handout

Handout turns a finished artifact into a durable, optionally password protected
address on your own infrastructure. This is the one document that says how to
run it, in three scenarios: trying it out on one machine, and two production
setups. Developing on Handout itself is a different thing, and is described in
the README.

## What is always the same

There is one `caddy/Caddyfile` and one `compose.yaml`. A scenario is exactly a
pair of two files: an env file under `env/` and a file of Caddy site blocks under
`caddy/sites/`. The env file names its site file itself (`CADDY_SITES`), so the
env file is the only thing you choose and fill. Why it is built this way is in
ADR 0032 in the repository's `docs/adr/`.

Every scenario goes the same way:

1. Clone the repository (or copy it) to the machine that runs it.
2. Copy the env file of the scenario to `.env` at the repository root and fill
   it. Each scenario below has a block that does this and fills everything that
   can be generated.
3. Start it: `docker compose --env-file .env up -d`. Scenario 1 uses its env
   file as it stands and needs no copy.

What you need:

- **Docker with Compose 2.20.0 or later** (`docker compose version`). The
  compose file makes the application's wait for Keycloak optional with
  `depends_on … required: false`, so that scenario 3 can leave Keycloak out;
  that keyword is unknown to older versions, which refuse the whole file.
- **For the production scenarios, 2 and 3: two DNS records** pointing at the
  machine, the domain and a wildcard under it (`handout.example.com` and
  `*.handout.example.com`), and **ports 80 and 443 reachable from the
  internet**. Without the ports no certificate is ever issued. No access to the
  DNS zone, no API token, no certificate file that anybody touches: Caddy obtains
  a certificate for every name it serves, by itself, from Let's Encrypt.
- **For the production scenarios, 2 and 3: OpenSSL** (`openssl version`) on the
  machine where you run the env blocks below, which call `openssl rand` to
  generate the secrets.

## Which scenario takes which files

| # | Scenario | Env file | Caddy site file | Identity provider |
| --- | --- | --- | --- | --- |
| 1 | [Trying it out locally with Docker](#scenario-1-trying-it-out-locally-with-docker) | `env/local.env.example` | `caddy/sites/local.caddyfile` | the bundled Keycloak |
| 2 | [Production, bundled Keycloak](#scenario-2-production-with-the-bundled-keycloak) | `env/production.env.example` | `caddy/sites/edge-keycloak.caddyfile` | the bundled Keycloak |
| 3 | [Production, an identity provider you have](#scenario-3-production-with-an-identity-provider-you-have) | `env/production-external-idp.env.example` | `caddy/sites/edge.caddyfile` | yours, no Keycloak runs |

The site file is chosen by `CADDY_SITES` in the env file. Scenarios 2 and 3 are
described together at the end, under "What scenarios 2 and 3 share".

## Scenario 1: Trying it out locally with Docker

You need Docker with Compose 2.20.0 or later and nothing else. Nothing here is
a secret and nothing has to be filled: the env file's values are local
development values in the open, for the reason `keycloak/README.md` gives for the
realm fixture. Copy it anyway, like every other scenario - then a value you
change for your own run stays out of git. In a clone of this repository:

```sh
cp env/local.env.example .env
docker compose --env-file .env up
```

That brings up the publisher interface at `http://handout.localhost:8080/`.
Sign in as `miriam` with the password `handout` (a second publisher, `joerg`,
has the same password), publish something from `data/testfiles/`, then open the
address that comes back. Names under `.localhost` resolve to loopback in current
browsers on macOS and Windows, so there is nothing to add to `hosts` and no DNS
to set up.

What comes up: Caddy on `http://handout.localhost:8080/`, the application behind
it, PostgreSQL, and Keycloak on `http://localhost:8081` (admin console `admin` /
`admin`) as the configured OIDC provider. The env file fills the same thirteen
variables an operator fills; there is no demo mode in the application. The
address is fixed because its redirect URI is registered in
`keycloak/realm.json`.

What survives, what does not: the published artifacts live in `./artifacts`,
beside `compose.yaml` and out of git; the two databases and Caddy's store are
Docker named volumes. All of it survives `docker compose down`. Keycloak's realm
is imported once; to start over from the fixture, discard the volumes and the
artifacts together:

```sh
docker compose --env-file env/local.env.example down -v
sudo rm -rf artifacts   # on Linux the container owns what it wrote there; macOS needs no sudo
```

To move to a newer version, change the tag as described under "A newer version"
below, and pass `env/local.env.example` as the env file.

## Scenario 2: Production with the bundled Keycloak

Handout, Caddy, PostgreSQL and a Keycloak run next to each other on one machine.
Keycloak is the identity provider; you create the publishers in it by hand.

Before you start:

- Docker with Compose 2.20.0 or later on the machine.
- Two DNS records pointing at it: `handout.example.com` and
  `*.handout.example.com`. The Keycloak's `id.handout.example.com` is covered by
  the wildcard record, which is why two are enough.
- Ports 80 and 443 reachable from the internet.
- OpenSSL, for the `openssl rand` calls in the block below.

Clone the repository to the machine, then run the block below in its root.
**Edit the first sed command before you run it**: the two domains, the address
Let's Encrypt writes to and the artifacts directory are yours to choose, they cannot
be generated, and the block does not know them. Everything else is generated,
with `openssl rand -hex 32`: hexadecimal, so no secret can contain a character
that breaks a connection URL.

**The block overwrites an existing `.env`, and mints new secrets.** Run it once,
before the first start. Run against a live instance it writes new passwords for
databases that still hold the old ones, and nothing starts any more. To change a
value later, edit `.env` by hand.

```sh
# Overwrites an existing .env. Run it once, before the first start.
cp env/production.env.example .env
# EDIT THESE FOUR LINES: they are yours to choose and cannot be generated.
sed -i.bak \
  -e 's|^HANDOUT_DOMAIN=.*|HANDOUT_DOMAIN=handout.example.com|' \
  -e 's|^KEYCLOAK_DOMAIN=.*|KEYCLOAK_DOMAIN=id.handout.example.com|' \
  -e 's|^ACME_EMAIL=.*|ACME_EMAIL=you@example.com|' \
  -e 's|^HANDOUT_ARTIFACTS_DIR=.*|HANDOUT_ARTIFACTS_DIR=/srv/handout/artifacts|' \
  .env
# Generated: every secret, and the temporary administrator of Keycloak.
sed -i.bak \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|" \
  -e "s|^KC_DB_PASSWORD=.*|KC_DB_PASSWORD=$(openssl rand -hex 32)|" \
  -e 's|^KC_BOOTSTRAP_ADMIN_USERNAME=.*|KC_BOOTSTRAP_ADMIN_USERNAME=admin|' \
  -e "s|^KC_BOOTSTRAP_ADMIN_PASSWORD=.*|KC_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 32)|" \
  -e "s|^OIDC_CLIENT_SECRET=.*|OIDC_CLIENT_SECRET=$(openssl rand -hex 32)|" \
  -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" \
  .env
rm -f .env.bak
# Lists every value that is still empty; nothing should be.
grep -n '^[A-Z0-9_]*=$' .env || echo "no empty value left"
```

The bootstrap administrator is `admin`, and its password is the one in `.env`
(`grep KC_BOOTSTRAP_ADMIN_PASSWORD .env`). Then start it:

```sh
docker compose --env-file .env up -d
```

The application runs its migrations, Caddy obtains the certificates for the
publisher origin and for Keycloak, and Keycloak imports the realm. The
application waits until Keycloak is healthy, which on the very first start takes
a while. Then continue with "The identity provider's first sign-in (scenario 2)" below.

The variables of `.env` that are not empty in the example are what this scenario
is; change one only if you know why. Two of the application's thirteen differ
from the local trial: `SESSION_COOKIE_SECURE` is `true`, because every request
the browser makes is HTTPS, and `OIDC_ISSUER_URL` is Keycloak under its own
public name, `https://<KEYCLOAK_DOMAIN>/realms/handout`. One that does not differ
still deserves a word: `OIDC_ALLOW_INSECURE_HTTP` is `true` although everything
the browser sees is HTTPS, because the one plain-HTTP request is the
application's hop to Keycloak inside the compose network (`OIDC_BACKCHANNEL_URL`,
ADR 0005 in `docs/adr/`), which never leaves the host.

## Scenario 3: Production with an identity provider you have

Handout, Caddy and PostgreSQL run on one machine and the application signs
people in against your own OIDC provider. No Keycloak runs: the env file leaves
`COMPOSE_PROFILES` out, and that is what leaves it out.

Before you start:

- Docker with Compose 2.20.0 or later on the machine.
- Two DNS records pointing at it: `handout.example.com` and
  `*.handout.example.com`.
- Ports 80 and 443 reachable from the internet.
- **A confidential client registered at your provider**, which speaks OIDC:
  redirect URI `https://handout.example.com/auth/callback`, post-logout redirect
  URI `https://handout.example.com/` (your own domain in both). That gives you
  the three values below.
- **A role for everyone who may publish**, which your provider puts into the ID
  token's top-level `roles` claim. Its value is `OIDC_REQUIRED_ROLE`. For
  Microsoft Entra ID this is an app role, see below.
- OpenSSL, for the `openssl rand` calls in the block below.

Clone the repository to the machine, then run the block below in its root.
**Edit the first sed command before you run it**: the domain, the address Let's
Encrypt writes to and the artifacts directory are yours to choose and cannot be
generated. The block generates two secrets, the session secret and the
database password, with `openssl rand -hex 32`: hexadecimal, so neither can
contain a character that breaks a connection URL.

The block can do only that half. The OIDC coordinates come from your provider,
and stay empty until you fill them: `OIDC_ISSUER_URL` (the issuer as your
tokens carry it, e.g. `https://login.example.com/realms/company`),
`OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` (both of the client you registered),
`OIDC_REQUIRED_ROLE` (the role's value), and the fifth, `OIDC_BACKCHANNEL_URL`, which the example already sets to the
issuer and which you change only if your provider is reached differently from
this machine. The last line of the block lists the empty ones, so the four
that are yours are what it prints.

**The block overwrites an existing `.env`, and mints new secrets.** Run it once.
Run against a live instance it writes a new database password for a database
that still holds the old one, and nothing starts any more. To change a value
later, edit `.env` by hand.

```sh
# Overwrites an existing .env. Run it once, before the first start.
cp env/production-external-idp.env.example .env
# EDIT THESE THREE LINES: they are yours to choose and cannot be generated.
sed -i.bak \
  -e 's|^HANDOUT_DOMAIN=.*|HANDOUT_DOMAIN=handout.example.com|' \
  -e 's|^ACME_EMAIL=.*|ACME_EMAIL=you@example.com|' \
  -e 's|^HANDOUT_ARTIFACTS_DIR=.*|HANDOUT_ARTIFACTS_DIR=/srv/handout/artifacts|' \
  .env
# Generated: the two secrets this scenario owns.
sed -i.bak \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|" \
  -e "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" \
  .env
rm -f .env.bak
# Lists every value that is still empty: your provider's, and only those.
grep -n '^[A-Z0-9_]*=$' .env
```

Fill the four it lists in `.env`, then start it:

```sh
docker compose --env-file .env up -d
```

The application runs its migrations and Caddy obtains the certificate for the
publisher origin and, on demand, for every handout. There is nothing more to set
up: sign in with your own provider.

Two of the application's thirteen differ from the local trial: `SESSION_COOKIE_SECURE`
is `true`, because every request the browser makes is HTTPS, and
`OIDC_ALLOW_INSECURE_HTTP` is `false`, because a provider you did not install is
reached over HTTPS from the application; if yours is not, set it to `true`
knowingly.

### Microsoft Entra ID

Entra ID is an OIDC provider like any other; these steps produce the values the
env file needs.

1. **App registration.** *App registrations* → *New registration*, accounts in
   this organizational directory only, redirect URI of platform *Web*:
   `https://handout.example.com/auth/callback`. Then, under *Authentication*,
   add `https://handout.example.com/` as a second *Web* redirect URI: Entra
   accepts a post-logout address only when it is registered as a redirect URI.
2. **Client secret.** *Certificates & secrets* → *New client secret*. Its value,
   shown once, is `OIDC_CLIENT_SECRET`. It expires (at most after two years); an
   expired secret makes every sign-in fail.
3. **App role.** *App roles* → *Create app role*: display name `Publisher`,
   allowed member types *Users/Groups*, value `publisher`, enabled. The value is
   `OIDC_REQUIRED_ROLE`.
4. **Assignment.** *Enterprise applications* → the application of the same name
   → *Properties* → *Assignment required?* Yes. Then *Users and groups* → *Add
   user/group*: the group of people who may publish, with the role `Publisher`.
   Assigning a group needs Entra ID P1 or higher; without it, assign people one
   by one. With assignment required Entra already turns away whoever has none;
   Handout's own check is the second wall, for the day that setting is switched
   off.
5. **Email.** *Token configuration* → *Add optional claim* → token type *ID* →
   `email`. Handout keeps it as a note beside the owner; without it that note
   stays empty.

| Variable | Value |
| --- | --- |
| `OIDC_ISSUER_URL` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `OIDC_BACKCHANNEL_URL` | the same |
| `OIDC_CLIENT_ID` | the registration's *Application (client) ID* |
| `OIDC_CLIENT_SECRET` | the secret from step 2 |
| `OIDC_REQUIRED_ROLE` | `publisher` |

`<tenant-id>` is the *Directory (tenant) ID* on the registration's overview, a
GUID; not `common` or `organizations`, whose discovery document names an issuer
that the tokens do not carry.

Why an app role and not a group: a groups claim carries object IDs rather than
names, so the configured value would be an opaque GUID; it lists every group a
person is in rather than those that concern this application; and above about
200 groups Entra leaves the claim out of the token and sends a pointer to the
Graph API instead (the "overage"), so the people in the most groups would be
turned away. An app role is named by the application and appears in `roles` only
for it.

## What scenarios 2 and 3 share

### Every variable you fill

The empty values of the env files of the two production scenarios. Each is
required, and the rest of the files is described in the README's
"Configuration".

| Variable | Scenarios | What it is for |
| --- | --- | --- |
| `HANDOUT_DOMAIN` | 2, 3 | the domain the publisher interface answers on, e.g. `handout.example.com`; a handout is `<address>.<this>` |
| `KEYCLOAK_DOMAIN` | 2 | the name the identity provider answers on, e.g. `id.handout.example.com`; the env file derives `KC_HOSTNAME` and `OIDC_ISSUER_URL` from it |
| `ACME_EMAIL` | 2, 3 | where Let's Encrypt sends expiry and policy notices |
| `HANDOUT_ARTIFACTS_DIR` | 2, 3 | the directory the published artifacts are kept in, e.g. `/srv/handout/artifacts`; the databases and Caddy's store are named volumes (see "What must persist") |
| `POSTGRES_PASSWORD` | 2, 3 | the password of the application's database. Compose puts it unencoded into a connection URL, so a value you choose yourself must avoid the characters with a special meaning there: `@`, `/`, `:` and `#`. The blocks generate hex, which cannot contain them; the caution stays for a `.env` a pipeline renders from its own secret store |
| `KC_DB_PASSWORD` | 2 | the password of Keycloak's own database |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | 2 | the temporary administrator of the identity provider's console, used once |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | 2 | that account's password |
| `OIDC_CLIENT_SECRET` | 2, 3 | the secret of the client: in scenario 2 you choose it, and the realm import and the application both read it; in scenario 3 it is the one your provider issued |
| `OIDC_ISSUER_URL` | 3 | your provider's issuer as tokens carry it, e.g. `https://login.example.com/realms/company` |
| `OIDC_CLIENT_ID` | 3 | the client id registered at your provider (scenario 2 fixes it to `handout-web`) |
| `OIDC_REQUIRED_ROLE` | 3 | the value of the role your provider puts into the ID token's `roles` claim for everyone who may publish (scenario 2 fixes it to `publisher`, the client role of the bundled realm) |
| `SESSION_SECRET` | 2, 3 | signs the session cookie of the application |

The role is checked at sign-in only: a person whose role is taken away keeps a
running session for up to eight hours.

`OIDC_BACKCHANNEL_URL` is the same realm as the application reaches it: inside
the compose network in scenario 2, the issuer itself in scenario 3.

The `.env` is a file on the target machine. Whether a person writes it or a
pipeline renders it from its secret store is the same file and the same compose;
neither is presupposed. Compose refuses to start and names the required value
that is missing.

### The identity provider's first sign-in (scenario 2)

Sign in to the admin console at `https://id.handout.example.com` with the
bootstrap administrator, once: create a permanent administrator in the `master`
realm, check that you can sign in with it, and delete the bootstrap account. Only
then create the publishers by hand in the realm `handout`. There is no
self-registration and no mail: a publisher gets a temporary password set in the
console. Each publisher also needs the client role `publisher` of the client
`handout-web` (*Users* → the user → *Role mapping* → *Assign role* → filter by
clients); without it the sign-in ends on "No access to Handout".

`KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` stay in the
`.env` afterwards. **Both must be filled before the first start**, which the
block does. Compose cannot require them (it also reads the Keycloak services in
scenario 3, where they do not exist), so an empty value is not refused: Keycloak
starts, reports healthy, imports the realm and creates no administrator, and
nobody can ever sign in. Keycloak reads the two variables only on the first start
against an empty database, so adding them afterwards changes nothing. The repair
is to stop the stack, remove the volume `handout_keycloak-db-data` (which
discards Keycloak's state, and it is empty of publishers at that point), fill
the values and start again. Never `down -v` for this: it removes the
application's database as well.

```sh
docker compose --env-file .env down
docker volume rm handout_keycloak-db-data
docker compose --env-file .env up -d
```

Keycloak's port 8080 is also published on the host's loopback interface as
`127.0.0.1:8081`. Production does not use it, and nothing outside the machine can
reach it; the same compose serves the local trial, which does.

The application's PostgreSQL is not published on the host in any of the three
scenarios. Only the development loop publishes it, on `127.0.0.1:5432`, through
`compose.dev.yaml`, so a PostgreSQL that already runs on the production machine
does not get in the way.

The realm has `sslRequired` set to `external`, not `all`. Keycloak's `all`
demands TLS from every address, including the application's back-channel hop over
the private compose network, and would refuse every token request.

The realm file is imported once. Keycloak skips the import when the realm already
exists, and this deployment keeps Keycloak's database in the volume `handout_keycloak-db-data`.
So editing `keycloak/realm.production.json` later changes nothing, and a later
change of `HANDOUT_DOMAIN` means changing the client's redirect URI and
post-logout URI in the admin console by hand.

A realm imported before Handout checked the role has neither the role nor its
mapper, and the import never runs again; add both in the admin console before
upgrading (client `handout-web` → *Roles* → *Create role* `publisher`; *Client
scopes* → `handout-web-dedicated` → *Add mapper* → *By configuration* → *User
Client Role*, client ID `handout-web`, token claim name `roles`, multivalued on,
add to ID token on), then assign the role to every publisher.

In scenario 3 there is no first sign-in to prepare: whoever your provider lets in and gives the
role in `OIDC_REQUIRED_ROLE` can publish.

### What must persist

Four things hold state, and all four must survive an update and a restart. Three
of them are Docker named volumes, one is a directory you choose:

| What | Where | Lost with it |
| --- | --- | --- |
| the published artifacts | the directory `HANDOUT_ARTIFACTS_DIR` (`/srv/handout/artifacts` is a sensible choice), a bind mount | the content of every handout |
| the application's database | the volume `handout_postgres-data` | every handout, address and password |
| Keycloak's database | the volume `handout_keycloak-db-data` (scenario 2 only) | the publishers' accounts |
| Caddy's certificate store | the volume `handout_caddy-data` | the certificates obtained so far, see below |

All four survive `docker compose down`, a restart and an upgrade. The volumes do
not survive `docker compose down -v`, `docker volume rm` or `docker volume prune`
run while the stack is stopped. `.env` is not state, but it holds the secrets the
databases were created with, so keep a copy of it too.

Why the databases are volumes and not directories you can see: a bind mount is
owned by whoever the host maps it to. Docker Desktop on macOS and Windows maps it
to your user, so PostgreSQL finds the data directory owned by a stranger and
refuses to initialise ("data directory has wrong ownership"). A volume belongs to
Docker and has no such problem on any platform (ADR 0033 in `docs/adr/`). The
artifacts are plain files and stay a directory, because that is what you want to
see and copy.

Losing Caddy's store does not reissue everything at once. The two named hosts,
the publisher origin and the identity provider, are obtained again at startup,
and a handout's certificate is obtained again only when a request for that
address next arrives. The risk is traffic arriving for many addresses faster than
the allowance refills (see "Three things that look like faults and are not"
below): the addresses beyond it stay unreachable until it does.

Nothing has to exist beforehand: Docker creates the volumes on the first start
and the artifacts directory too. To choose the owner and mode of that directory
yourself, create it first:

```sh
sudo mkdir -p /srv/handout/artifacts
```

The volume names carry the project name, `handout` (`docker volume ls`).

The containers are named `handout-app`, `handout-caddy`, `handout-db`,
`handout-keycloak`, `handout-keycloak-db` and `handout-data-owner`; the two
Keycloak ones exist in scenario 2 only. The fixed names mean a second copy of this
deployment cannot run on the same host.

### A newer version

`compose.yaml` pins the application to its released version. Change the tag in
`compose.yaml` (on `data-owner` and on `app`, which use the same image), then:

```sh
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

Migrations run at start and have no way back, so take a backup of the database
first. A release is tagged with its exact version and moves `latest`, and every
commit on `main` is published as `main` and `sha-<short>`, so there is something
to pull between releases; the version is semantic and below 1.0 (ADR 0027 in
`docs/adr/`).

### What a change of identity provider costs

Whoever starts with the shipped Keycloak and later moves to a company provider
gets a new identifier for every person, and a handout's owner is exactly that
identifier: the handouts published under Keycloak would be left without an
owner. ADR 0017 in `docs/adr/` foresaw this and keeps `owner_email` as a note, so
the operator can pull the new identifiers onto the old rows by hand, one
deliberate step per person. Decide this before starting with Keycloak, not after.

### Three things that look like faults and are not

- **The first call to a fresh address takes about a second longer.** The
  certificate is being obtained in that moment. Ports 80 and 443 must be
  reachable from outside for that to work at all: without them no certificate is
  ever issued and every address fails at the handshake.
- **The allowance for new handouts is 49 or 48 a week at the start, not 50.**
  Let's Encrypt allows 50 new certificates per registered domain per 7 days
  (checked on 2026-09-28). The deployment spends one on the publisher origin,
  and a second on the identity provider when the bundled Keycloak runs, so what
  is left for handouts is 49 in scenario 3 and 48 in scenario 2. The allowance
  refills over the window, not at a weekly boundary: a certificate obtained now
  frees its place seven days from now. Renewals are exempt (ARI), so a handout
  that exists costs nothing more however many there are and however long they
  live. A raise can be applied for at Let's Encrypt through a form.
- **The limit is per registered domain, not per hostname.** Every other service
  under the same registered domain that obtains Let's Encrypt certificates draws
  from the same 50. Whoever puts Handout under a domain already in use for other
  things has correspondingly fewer, and may hit the limit on the first day.

### Building your own deployment

Everything above is enough to run Handout without the compose file. What a proxy
in front of the application must do:

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

The application itself is one container that needs nothing but its thirteen
variables, a PostgreSQL, and a directory for the data. What must persist is the
list above. The container answers `GET /.handout/health` with `200` when it can
reach its database, and stops on `SIGTERM`.

Why one Caddyfile and one compose serve every deployment, and not one set each:
ADR 0032 in `docs/adr/`. Why a certificate per address, and what it costs: ADR
0029 there.
