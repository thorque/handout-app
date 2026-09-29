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
one compose file and one Caddyfile serve the three deployments in
`docs/deployment.md` and the development loop below. The two production ways
have been written against the documentation of their parts and not yet run
against a real domain.

## Developing

You need Node 22 or later and Docker with Compose 2.20.0 or later.

```sh
cp .env.example .env
npm install
npm run dev
```

Then open `http://handout.localhost:8080/` and sign in as `miriam` with the
password `handout`. Ctrl+C stops the application; `npm run dev:down` stops the
services it started.

## Developing in a Monoceros workbench (an alternative)

Not needed: the three lines above work anywhere. If you use
[Monoceros](https://getmonoceros.build), a workbench brings PostgreSQL, Keycloak
and Caddy itself. Name it `handout`, because the realm fixture registers
`handout.localhost` and `handout-caddy.localhost`. On the host:

```sh
monoceros init handout --with-languages=node --with-services=postgres,caddy,keycloak --with-repos=https://github.com/thorque/handout-app.git --with-ports=3000
```

Then add this to the yml (`$MONOCEROS_HOME/container-configs/handout.yml`), each
part under the service it names, and the three values to `handout.env` beside it:

```yaml
# under the caddy service
volumes:
  - projects/handout-app/caddy:/etc/caddy:ro
env:
  CADDY_SITE_ADDRESS: ${CADDY_SITE_ADDRESS}
  APP_HOST: ${APP_HOST}
  APP_PORT: ${APP_PORT}
# under the keycloak service
volumes:
  - projects/handout-app/keycloak/realm.json:/opt/keycloak/data/import/handout-app.json:ro
```

```
CADDY_SITE_ADDRESS=:81
APP_HOST=workspace
APP_PORT=3000
```

Nothing else configures Caddy: with no `CADDY_SITES` set, `caddy/Caddyfile`
imports `sites/local.caddyfile`. Build it and go in:

```sh
monoceros apply handout
monoceros shell handout
```

In `projects/handout-app`, fill `.env` from the environment the workbench
exports, then start the app through its launch config
(`.monoceros/launch.json`):

```sh
# Overwrites an existing .env.
cp .env.example .env
sed -i.bak \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=$POSTGRES_URL|" \
  -e "s|^OIDC_ISSUER_URL=.*|OIDC_ISSUER_URL=$KEYCLOAK_PUBLIC_URL/realms/handout|" \
  -e "s|^OIDC_BACKCHANNEL_URL=.*|OIDC_BACKCHANNEL_URL=$KEYCLOAK_URL/realms/handout|" \
  -e "s|^POSTGRES_URL=.*|POSTGRES_URL=$POSTGRES_URL|" \
  .env
rm -f .env.bak
npm install
monoceros-ctl start handout-app   # on the host: monoceros start handout handout-app
```

Do not use `npm run dev` there: the workbench has the services already.
`http://handout-caddy.localhost` is Caddy in front of the application and
`http://handout.localhost` the application directly (`monoceros port handout`
lists the routes). The routing knows exact host names only, so reach a handout's
address `<address>.handout.localhost` through a tunnel to Caddy:

```sh
monoceros tunnel handout caddy   # then http://<address>.handout.localhost:81/
```

`monoceros share handout handout-app` opens the app to another device over HTTPS.

## Running it, in production or to try it

How to run a released Handout, and how to try it on one machine with nothing but
Docker, is one document: [`docs/deployment.md`](docs/deployment.md). It has
three scenarios, each with its env file and a block that fills it in:

| Scenario | Env file | Identity provider |
| --- | --- | --- |
| Trying it out locally with Docker | [`env/local.env.example`](env/local.env.example) | the bundled Keycloak |
| Production, bundled Keycloak | [`env/production.env.example`](env/production.env.example) | the bundled Keycloak |
| Production, an identity provider you have | [`env/production-external-idp.env.example`](env/production-external-idp.env.example) | yours, no Keycloak runs |

Why it is built this way, with one Caddyfile and one compose:
`docs/adr/0032-one-caddyfile-one-compose-four-scenarios.md`.

## Configuration

Every value comes from an environment variable, and there are no defaults: a
missing value aborts the start and names itself.

The deployment around the application, in the env files (compose reads them;
Caddy reads the ones marked Caddy). "Dev" is the development loop's
`.env.example`; the numbers are the scenarios of `docs/deployment.md`: 1 is the
local trial, 2 production with the bundled Keycloak, 3 production with your own
identity provider.

| Variable | Used by | What it is for |
| --- | --- | --- |
| `COMPOSE_PROFILES` | dev, 1, 2 | `keycloak` brings up the bundled Keycloak and its database; absent, as in scenario 3, neither runs |
| `CADDY_SITES` | dev, 1, 2, 3 | Caddy: the file of site blocks under `caddy/`, e.g. `sites/edge.caddyfile`. Left unset, the Caddyfile serves `sites/local.caddyfile` |
| `CADDY_SITE_ADDRESS` | dev, 1 | Caddy: the address `local.caddyfile` serves; a port and no host name |
| `HTTP_PORT`, `HTTPS_PORT` | dev, 1, 2, 3 | the host ports Caddy's 80 and 443 are published on: 8080 and 8443 locally, 80 and 443 in production |
| `HANDOUT_DOMAIN` | dev, 1, 2, 3 | the domain the publisher interface answers on; a handout is `<address>.<this>` |
| `KEYCLOAK_DOMAIN` | 2 | Caddy: the name the bundled Keycloak answers on |
| `ACME_EMAIL` | dev, 1, 2, 3 | Caddy: where Let's Encrypt writes to; unused in the trial and the loop |
| `HANDOUT_STATE_DIR` | dev, 1, 2, 3 | the one directory that holds all persistent state |
| `POSTGRES_PASSWORD` | dev, 1, 2, 3 | the password of the application's database |
| `KEYCLOAK_COMMAND`, `KEYCLOAK_REALM_FILE`, `KC_HOSTNAME`, `KC_DB_PASSWORD`, `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` | dev, 1, 2 | the bundled Keycloak: how it starts, which realm it imports, the URL it is reached at, its database password and its first administrator |
| `APP_HOST`, `APP_PORT`, `KEYCLOAK_HOST`, `KEYCLOAK_PORT` | Caddy | where Caddy reaches the application and Keycloak; compose sets them to the service names. The development loop sets `APP_HOST` to `host.docker.internal`, a workbench's host configuration sets the first two |

The application's own twelve variables, all in `.env.example` with the same
sentence as a comment above each, and in every env file of a deployment with the
value that deployment needs:

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
