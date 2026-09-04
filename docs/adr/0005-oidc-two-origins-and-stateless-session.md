# 5. OIDC uses two configured origins, and the session is a signed cookie

Date: 2026-09-04
Status: accepted

## Context

The publisher signs in against a configured identity provider over OIDC. The
issuer identifier has to be one fixed string that appears in the ID token, and
the browser has to be able to reach the authorization endpoint under it. In the
workbench the browser reaches Keycloak at `http://handout-keycloak.localhost` and
the application reaches it at `http://keycloak:8080`; neither name works on the
other side. That split is not a workbench artefact — a provider behind an
internal address and a public issuer is a normal production shape too.

Handout manages no people: `owner` is whatever identifier the provider hands
over, and there is no `User` entity, so there is also no place to keep sessions.

## Decision

Two variables, both without defaults: `OIDC_ISSUER_URL` — the issuer as tokens
carry it and as the browser sees it — and `OIDC_BACKCHANNEL_URL` — the same realm
as the application reaches it. The application fetches
`$OIDC_BACKCHANNEL_URL/.well-known/openid-configuration` itself and then assigns
every URL in the document an origin by which side of the flow uses it. Nothing is
kept as returned, because a provider stamps its document from the host that
fetched it — a document pulled over the back channel comes back with every field,
`issuer` included, on the back-channel origin.

- **Front channel**, the fields the browser is sent to — `issuer`,
  `authorization_endpoint`, `end_session_endpoint` — get `OIDC_ISSUER_URL`'s
  origin. `issuer` in particular is set to `OIDC_ISSUER_URL` exactly, because that
  is the string the ID token will carry and the one validation compares against.
- **Back channel**, the fields the application calls itself — `token_endpoint`,
  `jwks_uri`, `userinfo_endpoint` — get `OIDC_BACKCHANNEL_URL`'s origin.

The result is handed to `new openid.Configuration(...)`. `openid-client`'s
`discovery()` is not used, because it insists the document's issuer match the URL
it was fetched from, which is exactly what does not hold here.

The client is confidential with a client secret and PKCE (S256) on top, because
the code is redeemed by a server that can keep a secret; a public client would be
the wrong shape for a server-rendered application. In the workbench the secret is
pinned in `keycloak/realm.json` so it survives a realm re-import.

The session is a signed cookie `handout_session` carrying `{sub, name, email,
exp}`, signed with `SESSION_SECRET` through `@fastify/cookie`'s signer:
`httpOnly`, `sameSite=lax` so it survives the return from the provider, `path=/`,
`secure` from `SESSION_COOKIE_SECURE`, eight hours. The in-flight flow uses a
second short-lived signed cookie `handout_oidc` carrying `{state, codeVerifier,
returnTo}`, cleared at the callback.

## Consequences

There is no session table and no session store, so signing out is a cleared
cookie and a revoked token cannot be enforced before the eight hours are up.
Rotating `SESSION_SECRET` signs everyone out, which is the intended lever.

Both OIDC origins have to be configured together, and the trade-off of assigning
the issuer rather than reading it is that nothing compares `OIDC_ISSUER_URL`
against what the provider says: a wrong value is not caught at start-up, it is
caught at the first login, when the ID token's `iss` does not match and validation
rejects it. `OIDC_BACKCHANNEL_URL` still fails at start-up, because that is where
the document is fetched from. Because the workbench runs plain HTTP,
`OIDC_ALLOW_INSECURE_HTTP` exists and is a variable, not a code path guessing from
the URL.
