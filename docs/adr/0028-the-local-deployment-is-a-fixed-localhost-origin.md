# 28. The local deployment is a fixed .localhost origin over plain HTTP

Date: 2026-09-08

Status: accepted

## Context

Handout could not be run: there was an image but no compose, so trying it meant
installing Node, PostgreSQL and an identity provider by hand. What it takes to
try a self hosted product decides whether anybody ever does.

Two things make a local deployment awkward here. Every address Handout hands out
is the request's own host with the first label swapped, so the publisher origin
and a wildcard under it have to answer on one port. And the sign-in is OIDC, so
the origin the browser uses is registered as a redirect URI at the provider
before the first request, not discovered at runtime.

## Decision

The repository ships a `compose.yaml` that pulls the released image and brings up
Caddy, PostgreSQL and Keycloak with it. Nothing is built, and the application is
pinned to an exact version rather than a moving tag.

The publisher interface is at `http://handout.localhost:8080/`, a handout at
`http://<address>.handout.localhost:8080/`. Names under `.localhost` resolve to
loopback in current browsers on macOS and Windows without a DNS service and
without hosts entries, so the wildcard costs nothing. The origin is fixed rather
than configurable, because its redirect URI is in the realm fixture. Port 8080
rather than 80, because a development workbench may already own the same name on
port 80 and one name must not mean two things.

Plain HTTP, so `SESSION_COOKIE_SECURE=false` and `OIDC_ALLOW_INSECURE_HTTP=true`.
No certificate, no DNS-01 challenge, no Caddy build of our own.

The shipped Keycloak is not a demo mode. It is the configured provider, filling
the same variables an operator fills, and there is no branch in the application
that knows about it. It is published on an origin of its own next to Caddy
rather than behind it — the two configured OIDC origins of decision 5 already
carry that, so neither the Caddyfile nor the application changes.

The realm fixture stops pinning a front-end URL. Keycloak derives its issuer and
its endpoints from the request instead, which makes one file serve the workbench
and this deployment at once. Its two users, the client and the client secret stay
as they are; it keeps no volume, so a recreated container comes back with exactly
what the file says.

PostgreSQL and the data directory do keep volumes: a published handout that
disappears on a restart would teach the wrong thing about the product.

## Consequences

Anyone can run Handout with Docker and one command, and what they run is the
released image rather than their checkout.

The address is not free: reach the interface under a name the compose does not
serve and the sign-in ends at the provider's own error page, because that
origin's redirect URI is not registered. Changing the origin means changing the
realm fixture with it, and the test that guards this holds the compose, the realm
and the README to the same string.

Anything reachable from another machine needs its own compose: this one is plain
HTTP with a session cookie that is not `Secure`, an OIDC client that accepts
plain HTTP, and credentials in the open. It is a way to try the product and to
develop against it, not a deployment.
