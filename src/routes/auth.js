import * as openid from "openid-client";
import { requestOrigin, safeReturnTo } from "../host.js";
import {
  writeOidcState,
  readOidcState,
  clearOidcState,
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
    writeSession(reply, config, {
      sub: claims.sub,
      name: claims.name || "",
      email: claims.email || "",
    });

    return reply.redirect(
      safeReturnTo(oidcState.returnTo, requestOrigin(request)),
    );
  });

  fastify.post("/auth/logout", async (request, reply) => {
    clearSession(reply);
    return reply.redirect("/");
  });
}
