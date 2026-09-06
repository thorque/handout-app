# 16. Signing out ends the session at the provider, and the ID token rides in the cookie

Date: 2026-09-06
Status: accepted

Amends docs/adr/0005-oidc-two-origins-and-stateless-session.md, whose session
payload this widens by one field. Everything else 0005 decided stands.

## Context

Signing out cleared Handout's own session cookie and redirected to `/`. That is
not signing out. The provider still held its own session, so the redirect ran
into `requireUser`, which sent the browser to `/auth/login`, which sent it to
the provider, which recognised its session and handed back a fresh code without
ever showing a login screen. The publisher landed on the dashboard again, still
signed in, having pressed "Sign out".

The failure is invisible in the one case a developer tests — a fresh browser,
one account — and shows up in exactly the cases that matter: two people at one
machine, and one person checking what a colleague's account can see. It was
found while testing that the dashboard lists only its owner's handouts, which
needs two accounts and therefore needs signing out to work.

OpenID Connect answers this with RP-initiated logout: the client sends the
browser to the provider's `end_session_endpoint`, and the provider ends its own
session and returns the browser to a registered address. The endpoint was
already being resolved to the front-channel origin (0005) and had no caller.

That request should carry `id_token_hint`, the ID token from the sign-in. It
names which session is meant, and it is what lets the provider act without
asking the person to confirm. Handout keeps no session store (0005: `owner` is
whatever the provider hands over, there is no `User` entity), so there is
nowhere to put that token except the session cookie itself — which is why this
touches 0005 at all.

The alternative was to send `client_id` instead and let the provider ask "do
you want to log out?" on its own page. It keeps the cookie as it was, at the
cost of a screen that is not Handout's in the middle of a one-click action, on
every sign-out, forever. Rejected for that: the cookie growing by a token is
cheaper than a foreign confirmation step in the product's own flow.

## Decision

`POST /auth/logout` clears the session cookie **and** redirects to the
provider's `end_session_endpoint`, built with `openid-client`, carrying
`post_logout_redirect_uri` — the requesting origin's `/`, derived from the
forwarded headers like every other absolute URL (0004) — and `id_token_hint`.

The session cookie carries one more field, `idToken`, written at the callback
and read at exactly one place, this logout. It is not a credential Handout acts
on: the session's identity is still the `{sub, name, email, exp}` claims from
0005, and nothing validates or forwards this token anywhere else.

Two fallbacks, both silent:

- A session cookie minted before this decision has no `idToken`. Then
  `client_id` goes instead, and the provider asks for confirmation rather than
  refusing the request.
- A provider whose discovery document has no `end_session_endpoint` leaves
  nothing to ask. Then the cleared cookie is all there is, and the redirect
  goes to `/` as before.

The workbench's realm fixture registers the post-logout addresses explicitly.
Keycloak's `+` means "the client's registered redirect URIs", and those all end
in `/auth/callback` — landing there without a code renders a failed sign-in, so
the four origins are listed by hand instead.

## Consequences

Signing out signs you out, everywhere the provider's session reached, which is
what the word means and what the header's "Sign out" now does.

The session cookie grows by roughly the size of an ID token, one to two
kilobytes. That is comfortably inside the 4 KB a browser guarantees per cookie,
but it is no longer a small cookie, and a provider stuffing an unusual number
of claims into its ID token would be the thing that pushes it over. Worth
knowing before another field is added to that cookie.

Handout still cannot enforce a revoked token before the eight hours are up
(0005): this ends the session at the provider going forward, it does not give
Handout a session store.
