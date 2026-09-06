# 19. A strong ETag per state

Date: 2026-09-06
Status: accepted

## Context

The promise a published update makes is not only "the same address" but
"the viewer gets the new thing" — a viewer who already had the address open
must not keep seeing the old state from their own cache after an update.
Artifact content is served from an `onRequest` hook in `src/app.js`, not
from a Fastify route, so nothing adds a caching validator for free, and
there is no `ETag` anywhere in the code today.

## Decision

Every artifact response carries a strong `ETag`:

```
"<state id>-<16 hex of sha256(path served)>"
```

The state id is the state token from ADR 0018 (or, for a handout still in
the legacy on-disk layout, the address itself); the path served is the path
inside the state's root after the entry and directory-index resolution have
run — so `/` and `/index.html` on the same state carry the same tag when
they resolve to the same file, and a request that resolves to a different
file gets a different tag. `If-None-Match` is answered with `304` and no
body when it matches; `cache-control` stays exactly what ADR 0010 already
sets (`no-cache` / `private, no-cache`), so a viewer revalidates on every
visit rather than trusting a cached copy for any length of time, and a swap
becomes visible on the viewer's very next request.

## Consequences

A state directory is immutable once installed — nothing ever rewrites a
file inside `<token>/` after it lands there — which is what makes the tag
strong rather than merely a cache-busting label. Because the served path is
part of the tag, a later change to which file `/` resolves to (a different
chosen entry page) changes `/`'s tag on its own, with no extra bookkeeping.
A `304` response carries the `etag` and the `cache-control` header and
nothing else — no `content-length`, no body.
