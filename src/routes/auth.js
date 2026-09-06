import * as openid from "openid-client";
import { requestOrigin, safeReturnTo } from "../host.js";
import {
  writeOidcState,
  readOidcState,
  clearOidcState,
  readSession,
  writeSession,
  clearSession,
} from "../session.js";
import { renderError } from "../views/error.js";
import { strings } from "../views/strings.js";

export default async function authRoutes(fastify) {
  const { oidcConfig, config } = fastify;

  fastify.get("/auth/login", async (request, reply) => {
    const state = openid.randomState();
    const codeVerifier = openid.randomPKCECodeVerifier();
    const codeChallenge = await openid.calculatePKCECodeChallenge(codeVerifier);
    // No query parameter is read here — requireUser already put the return
    // path into this same cookie before redirecting here with nothing on
    // the URL. A direct visit (no prior cookie) has nothing to return to.
    const priorState = readOidcState(request, config);
    const returnTo = (priorState && priorState.returnTo) || "/";

    writeOidcState(reply, config, { state, codeVerifier, returnTo });

    const redirectUri = `${requestOrigin(request)}/auth/callback`;
    const authorizationUrl = openid.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: "openid profile email",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return reply.redirect(authorizationUrl.href);
  });

  fastify.get("/auth/callback", async (request, reply) => {
    const oidcState = readOidcState(request, config);
    clearOidcState(reply);

    if (!oidcState || request.query.state !== oidcState.state) {
      return reply
        .code(400)
        .header("content-type", "text/html; charset=utf-8")
        .send(renderError({ message: strings["error.signInFailed"] }));
    }

    const currentUrl = new URL(`${requestOrigin(request)}${request.url}`);

    let tokens;
    try {
      tokens = await openid.authorizationCodeGrant(oidcConfig, currentUrl, {
        expectedState: oidcState.state,
        pkceCodeVerifier: oidcState.codeVerifier,
      });
    } catch {
      return reply
        .code(400)
        .header("content-type", "text/html; charset=utf-8")
        .send(renderError({ message: strings["error.signInFailed"] }));
    }

    const claims = tokens.claims();
    // The ID token travels in the session cookie for exactly one purpose: it
    // is what the provider wants back as `id_token_hint` when the session is
    // ended, and without it signing out cannot be silent. Nothing reads it as
    // a token — the claims above are the session, see
    // docs/adr/0016-signing-out-ends-the-session-at-the-provider.md.
    writeSession(reply, config, {
      sub: claims.sub,
      name: claims.name || "",
      email: claims.email || "",
      idToken: tokens.id_token,
    });

    return reply.redirect(
      safeReturnTo(oidcState.returnTo, requestOrigin(request)),
    );
  });

  // Clearing Handout's own cookie is not signing out: the provider still
  // holds its session, so the next request walks through /auth/login and is
  // signed straight back in without ever showing a login screen. The visible
  // effect is a "Sign out" that does nothing, and it is worst where it
  // matters most — two people sharing a machine, or one person checking what
  // a colleague can see. So the cookie is cleared AND the provider is asked
  // to end its own session (RP-initiated logout).
  fastify.post("/auth/logout", async (request, reply) => {
    const session = readSession(request, config);
    clearSession(reply);

    const endSessionEndpoint =
      oidcConfig.serverMetadata().end_session_endpoint || null;
    // A provider that does not offer the endpoint at all leaves nothing to
    // ask; clearing the cookie is then all a client can do, and pretending
    // otherwise would be a redirect to nowhere.
    if (!endSessionEndpoint) return reply.redirect("/");

    // `id_token_hint` names the session to end, which is what lets the
    // provider act without asking the person to confirm. A session cookie
    // written before this existed carries no ID token; `client_id` is the
    // documented stand-in, and the provider then asks for confirmation
    // rather than refusing.
    const parameters = {
      post_logout_redirect_uri: `${requestOrigin(request)}/`,
    };
    if (session && session.idToken) parameters.id_token_hint = session.idToken;
    else parameters.client_id = config.oidcClientId;

    return reply.redirect(
      openid.buildEndSessionUrl(oidcConfig, parameters).href,
    );
  });
}
