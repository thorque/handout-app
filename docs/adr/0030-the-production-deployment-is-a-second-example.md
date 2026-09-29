# 30. The production deployment is a second, self-contained example

Date: 2026-09-28

Status: accepted

## Context

The repository ships a local compose (`docs/adr/0028`). A public instance needs
the same product in a different shape: HTTPS, named hosts, a Keycloak in
production mode with its own database, secrets from the environment. The
question was whether that is a parameter of the local deployment or a
deployment of its own.

## Decision

The production deployment is its own directory, `deploy/`, with its own compose,
Caddyfile and realm, next to the local one. It parameterises nothing of it. It
is self-contained: copy the directory to a machine and nothing else is needed.

There is **one image and one version for both**. The two differ only in
configuration and are bumped together; `test/deployment.test.js` fails when one
file names a different version from the other.

One Caddyfile cannot carry both. The local deployment is a single bare-port site
with no TLS. Production is two named site blocks with ordinary certificates plus
a block for the hostname pattern `*.<domain>` with on-demand TLS, and a global
`on_demand_tls` block whose ask endpoint and two upstreams the local file has no
use for.

`import {$VAR}` was checked and does work, since environment variables are
substituted before the Caddyfile is parsed. It is rejected anyway: the two
deployments share no site block, so what an import could factor out is the
two-line proxy body, and a file whose whole content is an import is a second
Caddyfile with an indirection in front of it.

## Consequences

Two Caddyfiles, two composes and two realms that must be kept in step by hand.
`test/deployment.test.js` is what holds together the parts that must agree (the
image version, the ask path, the variables against the README), and CI validates
both Caddyfiles with the official Caddy image, because the production one runs
nowhere in development.
