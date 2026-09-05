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
`docs/adr/0009-password-stored-in-plain-text.md`).

Not there yet: a dashboard listing what you published, updating a handout in
place, deleting one, reissuing a password, the MCP endpoint for agents, a
published compose file, and a mode for operators who cannot get a wildcard DNS
entry.

## Getting it running

Running an instance is not possible yet: there is no release and no published
compose file. Planned is one compose with Caddy, the application and PostgreSQL,
configured entirely through environment variables, plus two DNS entries
(`handout.example.com` and `*.handout.example.com`) and a wildcard certificate
that Caddy obtains itself through the DNS-01 challenge.

What an instance needs, once there is a release:

- **Node 22 or newer** and **PostgreSQL 18**. The application is server rendered
  and has no build step, so there is nothing to compile and nothing to bundle.
- **A reverse proxy in front that passes host and scheme through** unchanged
  (`X-Forwarded-Host`, `X-Forwarded-Proto`) and serves the publisher origin and
  the wildcard as one vhost. Caddy is part of the product and its configuration
  lives in [`caddy/Caddyfile`](caddy/Caddyfile); it also holds the wildcard
  certificate through the DNS-01 challenge.
- **An OIDC provider** of your own. Handout manages no users: the publisher's
  identifier is whatever the provider hands over. `keycloak/realm.json` is a
  development fixture, not a deployment artifact - see
  [`keycloak/README.md`](keycloak/README.md).
- **A data directory** for the published artifacts, one directory per address
  (`docs/adr/0003-data-directory-and-entry-file.md`).

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
| `CADDY_SITE_ADDRESS` | the address Caddy serves. In production it carries the domains, so Caddy can obtain the wildcard certificate; in development it is just a port. |
| `APP_HOST`, `APP_PORT` | where Caddy reaches the application |

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

That is exactly right when the publisher origin and the wildcard are one vhost
on one port, which is what the Caddyfile sets up: `handout.example.com` and
`*.handout.example.com` answer on the same address, so the swapped label is
reachable.

It also means the reverse of it: reach the publisher interface under a name the
wildcard does not cover, and the addresses handed out under that name will be
derived correctly and still resolve nowhere. Nothing in the application can
detect that - it never learns which names exist. Publish under the name the
wildcard covers.

## License

Apache 2.0, see [LICENSE](LICENSE).

The interface ships its own copy of Source Sans 3 (weights 400 and 600),
licensed under the SIL Open Font License 1.1: see
[`src/public/fonts/LICENSE-source-sans-3.txt`](src/public/fonts/LICENSE-source-sans-3.txt).

## Contributing

Not settled yet. How contributions from outside are handled is a product
decision that has not been made, so this file stays silent on it until it is.
