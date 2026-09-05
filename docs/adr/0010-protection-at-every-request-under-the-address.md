# 10. Protection is decided on every request under an address, and Handout's own viewer pages live under one reserved prefix

Date: 2026-09-05
Status: accepted

## Context

The story's centre is that the protection covers the whole artifact and not the
entry page: an unprotected image or sub page makes the password decorative.
Every request under an address already passes through one place —
`serveContent` behind the host-dispatch hook in `src/app.js` — so the gate has
one place to live.

Two things make this less obvious than it sounds.

First, **the artifact owns every path under its address**. Handout never
touches the artifact, so the password page cannot be wrapped around content and
cannot borrow a path from it: reserving `/static/` or `/assets/` would break
real artifacts, which is exactly where those names come from. But the password
page needs a stylesheet and the shipped font, and those cannot come from the
publisher's origin — no hostname is ever configured, and the publisher's origin
is not derivable from an address host (in the workbench the publisher answers at
`handout-caddy.localhost` while addresses are `<label>.handout.localhost`).

Second, **path existence must not leak**. If the gate ran after path
resolution, a stranger would learn which files a protected artifact contains
from the difference between 404 and the password prompt.

## Decision

**One reserved prefix**, `/.handout/`, on the viewer side only:

    GET  /.handout/assets/*     Handout's own CSS and fonts, from src/public/
    GET  /.handout/password     the password page at a stable URL
    POST /.handout/password     the form's target

The host-dispatch hook lets exactly that prefix fall through to the routes;
everything else under an address goes to the artifact. A leading dot follows
the precedent ADR 0003 already set with the reserved `.handout` file, and it is
the smallest reservation that works: one prefix, no method-dependent
behaviour, and an artifact keeps `/static/`, `/assets/`, and every other name.

The stylesheet's font URLs are **relative** (`url("fonts/…woff2")`), so the one
file resolves correctly whether it is served at `/static/handout.css` or at
`/.handout/assets/handout.css`. That is what keeps the two sides from drifting.

**The gate**, in `serveContent`, in this order and no other:

1. the entry metadata for the address; missing → the unknown-address 404
2. the handout row behind the address; missing → the same 404 (which is
   already the right answer for a handout that was deleted while its address
   stays taken)
3. `password` null or empty → serve, unchanged
4. otherwise the unlock cookie decides; invalid or absent → **401** carrying
   the password page
5. only then the path is resolved and its own 404s can happen

Step 4 before step 5 is the point: a protected handout answers 401 for a path
that does not exist just as it does for one that does.

**One answer for every request.** A sub page, an image, an attachment and a
navigation all get the same 401 with the same page. The story's own test note
asks for 401 on a sub page and an image, and one behaviour is cheaper to reason
about than a content negotiation. No `WWW-Authenticate` header: `Basic` would
make the browser open its own dialog instead of the designed page.
`Cache-Control: no-store` on the 401, and `private, no-cache` on protected
content, so no shared cache ever holds either.

**The unlock cookie** is a second, separate cookie from the publisher's
session: `handout_unlock`, signed with `SESSION_SECRET` through
`@fastify/cookie`'s signer, carrying `{address, fingerprint, exp}`, `httpOnly`,
`sameSite=lax`, `path=/`, `secure` from `SESSION_COOKIE_SECURE`, twelve hours,
and **no `Domain` attribute** — the host it was set on is the handout's
address, and a `Domain` would hand it to sibling addresses. `sameSite=lax` and
not `strict`, because the viewer arrives by following a link from somewhere
else and `strict` would withhold the cookie on exactly that navigation.

`fingerprint` is the first 16 hex characters of the SHA-256 of the current
password. It is checked against the password read for this request, so
replacing a password invalidates every cookie already handed out,
and it is why the gate reads the row per request rather than trusting the
cookie alone. `address` is checked too, even though the cookie is host-scoped:
cookies do not isolate by port or scheme, and the check costs one comparison.

**The path the viewer wanted** is remembered the way ADR 0007 requires — never
round-tripped through the client. The 401 writes `request.url` into a signed,
short-lived `handout_next` cookie itself, and only when the request is a
navigation (`Accept` contains `text/html`), because a browser also asks for
`/favicon.ico` while showing the password page and the last 401 would otherwise
decide where the viewer lands. `POST /.handout/password` reads it back, clears
it, and redirects to `safeReturnTo(value, requestOrigin(request))` — ADR 0007's
function, unchanged. Nothing about the target ever comes from a form field or a
query parameter.

**A wrong password re-renders, it does not redirect**: the POST answers 401
with the same page carrying the error. There is no flash store to survive a
redirect and no reason to invent one. A correct password answers 303 to the
remembered path, or `/` when there is none.

## Consequences

Every request under a protected address costs one indexed lookup by address.
That is the price of the fingerprint check, and it buys a password change that
takes effect immediately.

An artifact that itself contains a top-level `.handout/` directory cannot serve
it. That is the same accepted price ADR 0003 already paid for the reserved
`.handout` file, one directory wider.

After a failed attempt the address bar reads `/.handout/password`, which is why
that path also answers `GET` — a reload lands on the page rather than on a JSON
404. And because the answer to everything unprotected is unchanged, a handout
without a password is never asked for one and never sets a cookie.
