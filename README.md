# Handout

Handout turns a finished artifact into a durable, optionally password protected
address on your own infrastructure: upload a file, hand out the link, and
everyone involved sees the current state from then on.

## What this is for

Prototypes, concepts and documents get sent around as files. The recipient has
to save them, unpack them, find the right file and open it - and again at every
update. After a handful of iterations there are a handful of copies on a handful
of machines, and nobody can say which one is current. Hosted services solve the
address but move the material off your own infrastructure and put the access
control behind a subscription.

Handout is the self hosted answer: one durable address per artifact, updated in
place. A zip, a single HTML file or a PDF goes in; a link comes out.

## Status

Publishing works: sign in, drop a zip, an HTML file or a PDF, get a durable
address back, and the artifact is served byte-for-byte unchanged under it. A
handout can carry a password, set while publishing it: the protection covers
every request under its address, not only the entry page, and the password
stays readable to the publisher (see
`docs/adr/0009-password-stored-in-plain-text.md`). A zip whose entry page is
not derivable now asks for it instead of being refused. Signing in lands on a
dashboard of your own handouts, with their address and their last state's
time; the row hands you the address, the password, or both together, ready to
paste into a message.

Updating a handout in place, deleting one and reissuing its password work too.
Not there yet: the MCP endpoint for agents, and a mode for operators who cannot
get a wildcard DNS entry. The application is published as a container image; a
compose file brings it up locally with Caddy, PostgreSQL and Keycloak, and a
second one in `deploy/` brings up a public instance over HTTPS with a
certificate per address. That second one has been written against the
documentation of its parts and not yet run against a real domain.

## Getting it running

### Try it

You need Docker and nothing else. In a clone of this repository:

    docker compose up

That brings up the publisher interface at `http://handout.localhost:8080/`.
Sign in as `miriam` with the password `handout` (a second publisher, `joerg`,
has the same password), publish something from `data/testfiles/`, then open
the address that comes back. Names under `.localhost` resolve to loopback in
current browsers on macOS and Windows, so there is nothing to add to `hosts`
and no DNS to set up.

### What comes up

Caddy on `http://handout.localhost:8080/`, the application behind it,
PostgreSQL, and Keycloak on `http://localhost:8081` (admin console `admin` /
`admin`) as the configured OIDC provider. The compose fills the same twelve
variables an operator fills; there is no demo mode in the application. The
values in `compose.yaml` are local development values in the open - the same
reason `keycloak/README.md` gives for the realm fixture - and the address is
fixed because its redirect URI is registered in `keycloak/realm.json`.

### What survives, what does not

The handouts and their addresses live in named volumes and survive
`docker compose down`. Keycloak has no volume, so a recreated container
re-imports `keycloak/realm.json` and loses anything clicked together in its
admin console. `docker compose down -v` throws the handouts away too.

### A newer version

`compose.yaml` pins the application to its released version. To move to a
newer one, change the tag on the `app` service (and on `data-owner`, which
uses the same image) and run:

    docker compose pull
    docker compose up -d

A release is tagged with its exact version and moves `latest`, and every
commit on `main` is published as `main` and `sha-<short>` so there is
something to pull between releases; the version is semantic and below 1.0
(see `docs/adr/0027-the-version-is-a-git-tag.md`).

### Running it on your own server

A public instance needs a domain, two DNS records, Docker, and the files in
[`deploy/`](deploy/). Everything below is enough to build the same deployment
without the compose file shipped here; the last part says what a proxy of your
own has to do.

#### What the environment must bring

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

#### The files

Copy [`deploy/`](deploy/) to the machine, copy `.env.example` to `.env` next to
`compose.yaml`, and fill it. The `.env` is a file on the target machine. Whether
a person writes it or a pipeline renders it from its secret store is the same
file and the same compose; neither is presupposed. Compose refuses to start
and names the value that is missing.

#### Every variable

The deployment's nine, in `deploy/.env.example`:

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

The Caddyfile in `deploy/caddy/` also reads `APP_HOST`, `APP_PORT`,
`KEYCLOAK_HOST` and `KEYCLOAK_PORT`; the compose sets them to the service names
and ports of the containers, and there is nothing to choose.

The application's own twelve are in the configuration table below, and the
compose fills them. Three differ from the local compose, for a reason each:

- `SESSION_COOKIE_SECURE` is `true`, because every request the browser makes is
  HTTPS here.
- `OIDC_ALLOW_INSECURE_HTTP` stays `true`. The one plain-HTTP request in this
  deployment is the application's hop to Keycloak inside the compose network
  (`OIDC_BACKCHANNEL_URL`, `docs/adr/0005-oidc-two-origins-and-stateless-session.md`),
  which never leaves the host. Set it to `false` when your provider is reachable
  over HTTPS from the application.
- `OIDC_ISSUER_URL` is `https://<KEYCLOAK_DOMAIN>/realms/handout`, the identity
  provider under its own public name.

#### The first start

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

#### The realm file is imported once

Keycloak skips the import when the realm already exists, and this deployment
keeps Keycloak's database in a volume. So editing `keycloak/realm.json` later
changes nothing, and a later change of `HANDOUT_DOMAIN` means changing the
client's redirect URI and post-logout URI in the admin console by hand.

#### What must persist, and what to back up

Four volumes, by the names in `deploy/compose.yaml`:

- `handout-data`: the published artifacts.
- `postgres-data`: the application's database, with the handouts, their
  addresses and their passwords.
- `keycloak-db-data`: Keycloak's database, with the publishers' accounts.
- `caddy-data`: Caddy's certificate store. Losing it means every certificate is
  issued again, and that does count against Let's Encrypt's weekly limit (see
  below).

Back up the first three. The fourth is worth keeping for the reason given.

#### A newer version

Change the tag in `deploy/compose.yaml` (on `data-owner` and on `app`), then:

    docker compose pull
    docker compose up -d

Migrations run at start and have no way back, so take a backup of the database
first. How versions are cut is in
`docs/adr/0027-the-version-is-a-git-tag.md`.

#### Three things that look like faults and are not

- **The first call to a fresh address takes about a second longer.** The
  certificate is being obtained in that moment.
- **Ports 80 and 443 must be reachable from outside**, or no certificate is
  ever issued and every address fails at the handshake.
- **The limit is 50 new handouts per week, not 50 handouts.** Let's Encrypt
  issues 50 new certificates per registered domain per 7 days (checked on
  2026-09-28). Renewals are exempt, so a handout that exists costs nothing more
  however many there are and however long they live. A raise can be applied for
  at Let's Encrypt through a form.

#### What a change of identity provider costs

Whoever starts with the shipped Keycloak and later moves to a company provider
gets a new identifier for every person, and a handout's owner is exactly that
identifier: the handouts published under Keycloak would be left without an
owner. `docs/adr/0017-the-owners-email-is-recorded-as-a-note.md` foresaw this
and keeps `owner_email` as a note, so the operator can pull the new identifiers
onto the old rows by hand, one deliberate step per person. Decide this before
starting with Keycloak, not after.

#### Building your own deployment

What a proxy in front of the application must do:

- Pass `X-Forwarded-Host` and `X-Forwarded-Proto` through unchanged.
- Serve the publisher origin and every `<address>.<publisher origin>`.
- Obtain a certificate per hostname on demand, and ask
  `GET /.handout/tls-check?domain=<hostname>` first, treating a 2xx as yes and
  everything else as no. The answer is that the first label is an address that
  was ever issued, so a stranger cannot spend the weekly limit on made-up names.
  The publisher origin and the identity provider are not addresses; give them
  certificates the ordinary way, not through that question.
- **Keep that path unreachable from outside**, as both Caddyfiles here do.

The application itself is one container that needs nothing but its twelve
variables, a PostgreSQL, and a volume for the data directory. What must persist
is the list above. The container answers `GET /.handout/health` with `200` when
it can reach its database, and stops on `SIGTERM`.

Why the deployment is a second example and not a parameterised first one:
`docs/adr/0030-the-production-deployment-is-a-second-example.md`. Why a
certificate per address, and what it costs:
`docs/adr/0029-a-certificate-per-address-obtained-on-demand.md`.

### Developing on it

To develop on it, set the variables below in a `.env` (copy
[`.env.example`](.env.example)), point `DATABASE_URL` at a PostgreSQL you can
reach, and:

    npm install
    npm start          # migrations run on start
    npm test           # needs POSTGRES_URL as well, see below
    npm run lint
    npm run check:refs # nothing in the tree points at a tracker or a wiki

## Configuration

Every value comes from an environment variable, and there are no defaults: a
missing value aborts the start and names itself.

| Variable | What it is for |
| --- | --- |
| `CADDY_SITE_ADDRESS` | the address the local Caddyfile (`caddy/Caddyfile`) serves; in development it is just a port. Only that file reads it. |
| `HANDOUT_DOMAIN`, `KEYCLOAK_DOMAIN`, `ACME_EMAIL` | read by the production Caddyfile (`deploy/caddy/Caddyfile`): the two names it serves and the address Let's Encrypt writes to. See the operator chapter above. |
| `APP_HOST`, `APP_PORT` | where Caddy reaches the application |
| `KEYCLOAK_HOST`, `KEYCLOAK_PORT` | where the production Caddyfile reaches the identity provider |

The application's own twelve variables, all in `.env.example` with the same
sentence as a comment above each:

| Variable | What it is for |
| --- | --- |
| `PORT` | the port the application listens on |
| `BIND_ADDRESS` | the interface it binds |
| `DATABASE_URL` | PostgreSQL connection string |
| `HANDOUT_DATA_DIR` | root of the data directory |
| `MAX_UPLOAD_BYTES` | the upload ceiling in bytes (documented as `524288000`, i.e. 500 MB) |
| `OIDC_ISSUER_URL` | the issuer as tokens carry it and the browser reaches it |
| `OIDC_BACKCHANNEL_URL` | the same realm as the application reaches it |
| `OIDC_CLIENT_ID` | the client registered at the provider |
| `OIDC_CLIENT_SECRET` | its secret |
| `OIDC_ALLOW_INSECURE_HTTP` | allow plain HTTP against the provider (`true`/`false`) |
| `SESSION_SECRET` | signs the session cookie |
| `SESSION_COOKIE_SECURE` | `Secure` on the cookies (`true`/`false`) |

A thirteenth variable, `POSTGRES_URL`, is needed only by the **test suite**
(`test/helpers/app.js`), never by the application itself: it is the
connection the tests use to create and drop the throwaway `handout_test`
database around each test file, so the role behind it must be allowed to
`CREATE DATABASE`. Anyone cloning this repository needs it set to run
`npm test`, even though the application never reads it. It is documented in
`.env.example` alongside the other twelve.

## Addresses come from the request, never from configuration

Worth knowing before you put a proxy in front of it, because it decides whether
a handed-out address works.

Handout derives every address it hands out from the request that asked for it
(`X-Forwarded-Proto` and `X-Forwarded-Host`), never from a configured hostname.
So a handout's address is the publisher's own origin with the first label
swapped, port and all: `CADDY_SITE_ADDRESS=sub.example.com:8080` yields
`https://<address>.sub.example.com:8080`.

That is exactly right when the publisher origin and the addresses under it are
served on one port, which is what the local Caddyfile sets up as one site:
`handout.localhost` and every `<address>.handout.localhost` answer on the same
address, so the swapped label is reachable. The production Caddyfile has the
same effect in three site blocks: the publisher origin and the identity
provider by name, and every `*.<domain>` host by pattern, each name with a
certificate of its own.

It also means the reverse of it: reach the publisher interface under a name the
hostname pattern does not cover, and the addresses handed out under that name
will be derived correctly and still resolve nowhere. Nothing in the application
can detect that - it never learns which names exist. Publish under the name the
pattern covers.

## License

Apache 2.0, see [LICENSE](LICENSE).

The interface ships its own copy of Source Sans 3 (weights 400 and 600),
licensed under the SIL Open Font License 1.1: see
[`src/public/fonts/LICENSE-source-sans-3.txt`](src/public/fonts/LICENSE-source-sans-3.txt).

## Contributing

Not settled yet. How contributions from outside are handled is a product
decision that has not been made, so this file stays silent on it until it is.
