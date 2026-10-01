# 34. Signing in requires a role in the ID token's `roles` claim

Date: 2026-10-01

Status: accepted

Amends docs/adr/0016-signing-out-ends-the-session-at-the-provider.md, whose
`id_token_hint` gains a second source, and
docs/adr/0005-oidc-two-origins-and-stateless-session.md, whose two cookies
become three. Both are left as they were written.

## Context

Until now whoever could sign in at the identity provider could use Handout, so
who may publish was decided by the provider's assignment alone. That assignment
changes over time and is kept by someone else in another tool, and a provider
without any assignment would open Handout to everyone it knows. Handout manages
no people and has no grades of permission, so what it checks itself has to be
one bit, read from what the provider hands over at sign-in.

## Decision

The callback checks the ID token's `roles` claim: it must be an array and
contain the value of `OIDC_REQUIRED_ROLE` exactly, case included. The claim
name is fixed; the value is configuration without a default, like every other
variable. `roles` is the claim Microsoft Entra ID sends for app roles and the
one the bundled realms' mapper writes, so one name covers the provider most
companies have and the one that ships. A missing claim, a string, or a value
that differs in case is a refusal.

Without the role the callback answers 403 with a page of its own, "No access to
Handout", writes no session and clears one that was already there, so a refused
sign-in does not leave another account's session standing in the same browser.
With the role everything continues as before. Whoever has it may do everything;
there are no grades. The check runs at sign-in and nowhere else: the role is not
copied into the session, and `requireUser` does not look for it.

The refused page offers "Sign out", and that has to end the provider's session,
or the next attempt is signed straight back in as the same refused account and
the person can never try another. There is no session to take the
`id_token_hint` from, so the callback keeps the refused sign-in's ID token, and
nothing else, in a separate signed cookie `handout_logout_hint`: `httpOnly`,
`path=/`, `sameSite=lax`, `secure` from `SESSION_COOKIE_SECURE`, ten minutes.
`POST /auth/logout` takes the hint from the session first and from that cookie
second, and clears both cookies. The hint is sent when either source has one;
without any hint the provider gets `client_id` alone. (openid-client appends
`client_id` to every end-session URL.) The cookie is signed with a key derived
from `SESSION_SECRET` and a fixed purpose label, and a session must carry a
`sub`, so its value is not a valid session cookie. Nothing else reads it; it is
not a session.

Rejected: sending `client_id` without a hint for the refused person. It needs no cookie, but
the provider then asks for confirmation on a page that is not Handout's, in the
middle of the one way out this page offers. ADR 0016 rejected the same screen
for every sign-out, and a person who was just turned away is the last one to
hand it to.

Rejected: a groups claim instead of a role. Entra ID's groups claim carries
object IDs rather than names, lists every group a person is in rather than those
that concern this application, and is replaced by a pointer to the Graph API
above about 200 groups, which would turn away exactly the people in the most
groups. A role is named by the application and appears only for it.

## Consequences

A revoked role takes effect at the next sign-in, at the latest when the session
expires after eight hours (`SESSION_MAX_AGE_SECONDS` in `src/session.js`).
Handout has no session store (0005) and still cannot end a running session
early; rotating `SESSION_SECRET` remains the lever that signs everyone out at
once. For the same reason an upgrade to a version with this check signs nobody
out: a session minted before it lasts until it expires.

A realm imported before this check has neither the role nor the mapper, and
Keycloak never imports a realm twice. Such an instance needs both added in the
admin console, and every publisher given the role, before the upgrade; otherwise
every sign-in ends on the refusal page. `docs/deployment.md` describes the
steps.

A provider that cannot put a role into a top-level `roles` claim of the ID token
cannot be used without a mapper on its side. A role that reaches only the access
token, which is where Keycloak puts client roles by default, does not count; the
bundled realms carry their mapper for exactly that reason.

The refused page's sign-out names the session silently for ten minutes. After
that the cookie is gone and the provider asks for confirmation, the old
fallback, no worse than before. The callback writes either the session or the
hint and clears the other, so a browser holds at most one ID token from one
sign-in.
