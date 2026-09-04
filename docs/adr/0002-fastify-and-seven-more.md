# 2. Fastify and seven more, and nothing else

Date: 2026-09-04
Status: accepted

## Context

Handout is a server-rendered Node application with no bundler and no build step.
A self-hosted tool that people run on their own infrastructure pays for every
dependency twice: once in supply chain, once in the upgrade treadmill. But two
parts of this story are genuinely hard to get right by hand — parsing a multipart
body that streams a 500 MB upload to disk without buffering it, and an OIDC
authorization code flow with PKCE and ID token validation.

## Decision

Eight direct runtime dependencies, pinned by exact version in `package.json`:
`fastify`, `@fastify/multipart`, `@fastify/cookie`, `@fastify/formbody`, `pg`,
`node-pg-migrate`, `openid-client`, `yauzl`. Nothing else, and no
devDependencies: tests run on `node:test`, which ships with Node.

Everything else is written here: HTML rendering (template functions returning
strings), static file serving, the content type map, session signing (via
`@fastify/cookie`'s signer), address generation, the CSS and the client
JavaScript. In particular `@fastify/static` is not taken, because serving files
is needed for the artifact anyway and one hardened handler serves both.

## Consequences

There is no template engine, so views are functions that return strings and every
interpolated value must be escaped explicitly by an `esc()` helper — a forgotten
call is an injection, and reviews look for it. There is no static-file plugin, so
the path traversal guard is ours to write and ours to test. Adding a ninth
dependency is a decision, not a convenience, and gets its own ADR.
