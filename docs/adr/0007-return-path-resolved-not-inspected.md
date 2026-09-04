# 7. A return path never round-trips through the client, and the one value still built from a request is checked on its way out

Date: 2026-09-04
Status: accepted

## Context

Signing in interrupts whatever the publisher was heading for, so that path has to
survive the login and come back afterwards as a redirect target. This is
CWE-601, open redirect, and it is worth naming why it is dangerous here
specifically: the victim gets a link on the operator's own domain, signs in at
the operator's own provider — a real login page, real credentials, nothing
forged — and Handout then hands them to the attacker's site, which asks them to
"sign in again". Every hop is genuine except the last, which is exactly why it
works: the usual advice, check the domain before you type your password, was
followed and still lost.

Three attempts at validating a caller-supplied return path each failed under
review, and the third failure is the one that settles the question. Round one
inspected the raw string for a leading `/` and rejected `//` and `/\`; a tab
byte defeated it, because the WHATWG URL parser strips tab, LF and CR before
parsing, so `/<tab>/evil.com` passes a check that reads the raw string and is
`//evil.com` by the time a browser resolves the `Location` header. Round two
resolved the value with `new URL()` instead of inspecting it, plus a
`decodeURIComponent` pass to fold away exactly that kind of encoding gap; `/..//evil.com`
defeated it, because the added decode step made a second layer of encoding
*live* across the round trip — the value is validated once when
`/auth/login` writes it into a cookie and again when `/auth/callback` reads it
back, and a value could look safe on the first pass and decode to
`//evil.com` on the second. Every one of the three attempts kept the same
shape: take a string from the client, decide whether it is safe, put it back
in a header. That shape is the mistake, not any one validation inside it.

## Decision

The return path is not taken from the client at all, so there is nothing left to
validate on the way in. `requireUser` writes it into the signed `handout_oidc`
cookie itself, from `request.url` of the request it is intercepting, at the
exact moment it intercepts it — the same cookie ADR 0005 already uses to carry
`state` and `codeVerifier` for the in-flight OIDC exchange, with `returnTo` as
a third field, because it is exactly the same kind of short-lived, signed,
server-written value. `GET /auth/login` then redirects with **no query
parameter at all**; it never reads `request.query.returnTo`, so a caller who
appends one — the only lever left — writes into a value nothing downstream
ever looks at. `GET /auth/callback` reads the path back out of that same
cookie. No hop in this chain takes the path from the client.

One value in this flow still comes from a request rather than from
configuration: `request.url`, because Fastify's router narrows it to whatever
matched `GET /` or `GET /handouts/:address`, and `:address` is a path segment a
caller chooses. So one check remains, on the value about to be written into
the `Location` header at the callback, not on anything read from a caller:

    const url = new URL(value, requestOrigin);
    if (url.origin !== requestOrigin) return "/";
    const target = url.pathname + url.search;
    if (new URL(target, requestOrigin).origin !== requestOrigin) return "/";
    return target;

The fourth line is the whole point, and it is what round two's single resolve
was missing: `new URL("/..//evil.com", "http://ours")` resolves the `..` away
and leaves `//evil.com`, an origin-bearing string that the *first* resolve's
origin check never saw, because it checked the resolved `URL` object's origin,
not the string that would be handed to a browser next. Re-resolving the
*output* — `pathname + search` — against the same origin is what catches it,
by asking the exact question a browser asks when it follows the header. It
also makes the function idempotent: calling it again on its own output changes
nothing, so there is no version of "call it twice by accident" that
re-opens the gap decoding once did.

`decodeURIComponent` and a first pass that tries the value as an absolute URL
are both gone. The decode was the direct cause of round two's failure — running
the check twice across a round trip is exactly what turns one extra encoding
layer into a live bypass — and it also corrupts legitimate paths
(`/handouts/a%2Fb` becomes two segments, `/?q=a%26b=c` becomes two query
parameters). The absolute-first stage existed only to force two rows
(`/%5Cevil`, `http:/evil`) to `/`; both already resolve onto this application's
own origin without it, so they are 404 pages, not open redirects, and forcing
them to `/` bought nothing real.

The function still returns `/` rather than throwing for every input that is
not a usable same-origin path: a repeated query parameter that arrives as an
array, a value that is not a string, `undefined`, a value past a sane length
cap, and anything that throws in the `URL` constructor.

## Consequences

There is no attacker-writable string anywhere in the return-path flow, so there
is nothing left to parse defensively except the one value this application
still builds from a request itself — and that value is checked on the way out,
not on the way in, which is the shape CWE-601's standard mitigation actually
asks for ("don't take the value from the client") rather than the shape all
three prior attempts shared ("validate the value once you have it"). The
publisher can only be returned to a path on the host they arrived on, which is
the whole point and costs nothing real: there is no case for sending them
elsewhere. The cap and the fallback mean a malformed value is a quiet return to
`/` and never a 500, so the refusal tells a prober nothing about whether their
payload was interesting.
