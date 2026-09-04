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
address back, and the artifact is served byte-for-byte unchanged under it.

Not there yet: a password on a handout, a dashboard listing what you published,
updating a handout in place, deleting one, the MCP endpoint for agents, a
published compose file, and a mode for operators who cannot get a wildcard DNS
entry.

## Getting it running

Running an instance is not possible yet: there is no release and no published
compose file. Planned is one compose with Caddy, the application and PostgreSQL,
configured entirely through environment variables, plus two DNS entries
(`handout.example.com` and `*.handout.example.com`) and a wildcard certificate
that Caddy obtains itself through the DNS-01 challenge.

Development happens in a Monoceros workbench:

    monoceros init handout \
      --with-languages=node \
      --with-services=postgres,caddy,keycloak \
      --with-features=claude,github,atlassian/twg,claude-code-roles \
      --with-ports=3000
    monoceros apply handout

## Configuration

Every value comes from an environment variable, and there are no defaults: a
missing value aborts the start and names itself.

| Variable | What it is for |
| --- | --- |
| `CADDY_SITE_ADDRESS` | the address Caddy serves. In production it carries the domains, so Caddy can obtain the wildcard certificate; in a workbench it is just a port. |
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

## Running it

In the Monoceros workbench:

    monoceros-ctl start handout-app
    monoceros-ctl logs handout-app --no-follow

Reachable three ways, each for a different purpose:

- `http://handout-caddy.localhost` - through Caddy, the production-like path.
- `http://handout.localhost` - the application directly, with Caddy out of the
  chain.
- a published handout's own address, only through
  `monoceros tunnel handout caddy`, then
  `http://<address>.handout.localhost:81/` - the Monoceros proxy routes exact
  hostnames only, so a generated subdomain needs the tunnel.

**To try a handout end to end, publish through the tunnel**, not through
`handout-caddy.localhost`:

    monoceros tunnel handout caddy     # on the host, keep it running

then open `http://handout.localhost:81`, publish there, and the address handed
back is `http://<address>.handout.localhost:81` - reachable through that same
tunnel.

The reason is worth knowing, because the workbench and a deployment differ here.
Handout derives every address it hands out from the request that asked for it
(`X-Forwarded-Proto` and `X-Forwarded-Host`), never from configuration. In a
deployment that is exactly right: `handout.example.com` and
`*.handout.example.com` are one wildcard vhost on one port, so a handout's
address is the publisher's own origin with the label swapped, port and all -
`CADDY_SITE_ADDRESS=sub.example.com:8080` yields
`https://<address>.sub.example.com:8080`.

In the workbench the two do not share a route. Publish via
`handout-caddy.localhost` and the derived address is
`http://<address>.handout-caddy.localhost`, which is correct for that origin and
still unreachable, because the Monoceros proxy has no wildcard rule for it. No
port would help; the tunnel is the way, and that is why it is the path to use for
anything that involves opening a handout.

## License

Apache 2.0, see [LICENSE](LICENSE).

The interface ships its own copy of Source Sans 3 (weights 400 and 600),
licensed under the SIL Open Font License 1.1: see
[`src/public/fonts/LICENSE-source-sans-3.txt`](src/public/fonts/LICENSE-source-sans-3.txt).

## Contributing

Not settled yet. How contributions from outside are handled is a product
decision that has not been made, so this file stays silent on it until it is.
