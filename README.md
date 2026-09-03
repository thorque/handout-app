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

Early. Nothing runs yet - the repository starts with these files, and the build
begins with the first function. What is decided is written down: two entities,
a server rendered interface, and one subdomain per handout.

Not there yet: the application itself, the MCP endpoint for agents, a published
compose file, and a mode for operators who cannot get a wildcard DNS entry.

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

The application's own variables - the database connection, the identity
provider, and the upload limit (500 MB by default) - are not named yet. They
arrive with the first function that needs them.

## License

Apache 2.0, see [LICENSE](LICENSE).

## Contributing

Not settled yet. How contributions from outside are handled is a product
decision that has not been made, so this file stays silent on it until it is.
