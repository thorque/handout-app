# 8. Development tooling is allowed and does not count against the dependency floor

Date: 2026-09-04
Status: accepted

Supersedes ADR 0002 on one point: that decision's "no devDependencies" is
superseded here. Everything else in ADR 0002 — the eight runtime dependencies,
pinned by exact version, and nothing else in `dependencies` — still holds and is
restated below, unchanged.

## Context

This story now also brings a linter, a formatter and a CI pipeline. None of them
run in production; all of them run on a developer's machine or in CI, against
source that a build step never ships. ADR 0002's "no devDependencies" was about
what gets deployed: a self-hosted Node application pays for every dependency
twice, once in supply chain and once in the upgrade treadmill, because Node has
no equivalent of shipping a single compiled binary — the whole dependency tree
travels with the running application. `eslint`, `prettier` and the packages they
pull in never travel with it; they exist only in the repository and in CI's
checkout, and `node:test` — the reason ADR 0002 gave for needing no
devDependencies at all — still needs none of its own.

## Decision

Runtime dependencies stay at eight, unchanged, still pinned by exact version in
`dependencies`, still nothing else added there without an ADR of its own — ADR
0002's decision on that point is not reopened.

Development tooling is allowed, listed separately under `devDependencies`, and
is exempt from ADR 0002's floor because it never reaches production:

- `eslint`, `@eslint/js` — the linter and its recommended rule set.
- `prettier` — the formatter.

Each pinned by exact version, the same discipline as the runtime eight, so an
upgrade is a decision made once and reviewed, not something `npm install`
silently drifts.

## Consequences

`npm ci` in development and in CI now installs more than eight packages, and
someone auditing the dependency tree has to look at `devDependencies`
specifically to find the runtime floor ADR 0002 fixed — the count in
`package.json`'s `dependencies` block is still eight, but the full install is
not. That is the honest cost of this decision: it does not shrink the install,
it only keeps the parts that matter for what ships separate from the parts that
do not.
