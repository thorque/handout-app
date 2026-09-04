# 4. Every absolute URL is derived from the request, never configured

Date: 2026-09-04
Status: accepted

## Context

Handout runs behind Caddy, in a workbench behind a second proxy, and over a LAN
share with a third name and a different scheme. Three absolute URLs have to be
right per request: the address handed out on the result screen, the OIDC redirect
URI, and any redirect the application issues. A configured base URL would be
wrong in at least one of those places, and a wrong redirect URI is a login that
cannot complete.

## Decision

One helper derives the origin of the current request: scheme from the first value
of `X-Forwarded-Proto` else the connection's scheme; host from the first value of
`X-Forwarded-Host` else the `Host` header, port included, lowercased. Both
headers may be comma-separated lists and only the first value is taken.

The handed-out address is that host with the label prepended:
`<scheme>://<label>.<host>`. The port travels with the host, so a workbench
reached at `handout.localhost:81` hands out `abc…:81` and the link works. No
domain is configured anywhere, which is the same rule host resolution already
follows in the other direction.

## Consequences

Handout is correct wherever it is put and has nothing to reconfigure when it
moves, but it is also only as trustworthy as its proxy: `X-Forwarded-*` is taken
at face value, so Caddy must set it and must not pass a client's version through.
That is why the Caddyfile opens with `trusted_proxies static private_ranges`.
Running Handout with no proxy in front of it and open to the internet would let a
caller choose the origin in its own login link; that is out of scope, since
Handout ships with Caddy in front of it as part of the product.
