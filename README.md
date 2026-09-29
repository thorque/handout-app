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
get a wildcard DNS entry. The application is published as a container image, and
one compose file and one Caddyfile serve the four ways below (the workbench
uses the Caddyfile only). The two production ways have been written against the
documentation of their parts and not yet run against a real domain.

## Getting it running

### Four ways to run it

There is one `caddy/Caddyfile` and one `compose.yaml`. What differs is a file
of Caddy site blocks and an env file, and each scenario has exactly one of each:

| # | Scenario | Env file | Caddy site file | Identity provider |
| --- | --- | --- | --- | --- |
| 1 | Developing in the Monoceros workbench | [`env/1-workbench.env.example`](env/1-workbench.env.example) | [`caddy/sites/local.caddyfile`](caddy/sites/local.caddyfile) | the workbench's Keycloak |
| 2 | Trying it out locally with Docker | [`env/2-local.env.example`](env/2-local.env.example) | [`caddy/sites/local.caddyfile`](caddy/sites/local.caddyfile) | the bundled Keycloak |
| 3 | Production, bundled Keycloak | [`env/3-production.env.example`](env/3-production.env.example) | [`caddy/sites/edge-keycloak.caddyfile`](caddy/sites/edge-keycloak.caddyfile) | the bundled Keycloak |
| 4 | Production, an identity provider you have | [`env/4-production-external-idp.env.example`](env/4-production-external-idp.env.example) | [`caddy/sites/edge.caddyfile`](caddy/sites/edge.caddyfile) | yours, no Keycloak runs |

How to set up each of them, step by step, is in
[`docs/deployment.md`](docs/deployment.md), including a block for each of them
that fills in the env file where there is something to fill. Why it is built this way:
`docs/adr/0032-one-caddyfile-one-compose-four-scenarios.md`.

## Configuration

Every value comes from an environment variable, and there are no defaults: a
missing value aborts the start and names itself.

The deployment around the application, in the env files of scenarios 2 to 4
(compose reads them; Caddy reads the ones marked Caddy):

| Variable | Scenarios | What it is for |
| --- | --- | --- |
| `COMPOSE_PROFILES` | 2, 3 | `keycloak` brings up the bundled Keycloak and its database; absent, as in scenario 4, neither runs |
| `CADDY_SITES` | 2, 3, 4 | Caddy: the file of site blocks under `caddy/`, e.g. `sites/edge.caddyfile`. The workbench sets nothing and gets `sites/local.caddyfile` |
| `CADDY_SITE_ADDRESS` | 1, 2 | Caddy: the address `local.caddyfile` serves; a port and no host name. The workbench's host configuration sets it, compose sets it in scenario 2 |
| `HTTP_PORT`, `HTTPS_PORT` | 2, 3, 4 | the host ports Caddy's 80 and 443 are published on: 8080 and 8443 locally, 80 and 443 in production |
| `HANDOUT_DOMAIN` | 2, 3, 4 | the domain the publisher interface answers on; a handout is `<address>.<this>` |
| `KEYCLOAK_DOMAIN` | 3 | Caddy: the name the bundled Keycloak answers on |
| `ACME_EMAIL` | 2, 3, 4 | Caddy: where Let's Encrypt writes to; unused in scenario 2 |
| `HANDOUT_STATE_DIR` | 2, 3, 4 | the one directory that holds all persistent state |
| `POSTGRES_PASSWORD` | 2, 3, 4 | the password of the application's database |
| `KEYCLOAK_COMMAND`, `KEYCLOAK_REALM_FILE`, `KC_HOSTNAME`, `KC_DB_PASSWORD`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` | 2, 3 | the bundled Keycloak: how it starts, which realm it imports, the URL it is reached at, its database password and its first administrator |
| `APP_HOST`, `APP_PORT`, `KEYCLOAK_HOST`, `KEYCLOAK_PORT` | Caddy | where Caddy reaches the application and Keycloak; compose sets them to the service names, and the workbench's host configuration sets the first two |

The application's own twelve variables, all in `env/1-workbench.env.example`
with the same sentence as a comment above each, and in every other env file
with the value that scenario needs:

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
`env/1-workbench.env.example` alongside the other twelve.

## Addresses come from the request, never from configuration

Worth knowing before you put a proxy in front of it, because it decides whether
a handed-out address works.

Handout derives every address it hands out from the request that asked for it
(`X-Forwarded-Proto` and `X-Forwarded-Host`), never from a configured hostname.
So a handout's address is the publisher's own origin with the first label
swapped, port and all: `CADDY_SITE_ADDRESS=sub.example.com:8080` yields
`https://<address>.sub.example.com:8080`.

That is exactly right when the publisher origin and the addresses under it are
served on one port, which is what `caddy/sites/local.caddyfile` sets up as one site:
`handout.localhost` and every `<address>.handout.localhost` answer on the same
address, so the swapped label is reachable. The production site files have the
same effect in site blocks of their own: the publisher origin (and, with the
bundled Keycloak, the identity provider) by name, and every `*.<domain>` host by
pattern, each name with a certificate of its own.

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
