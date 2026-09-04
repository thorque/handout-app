import http from "node:http";
import crypto from "node:crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function pkceMatches(codeVerifier, codeChallenge) {
  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return computed === codeChallenge;
}

// A minimal, in-process OIDC provider stub. It answers discovery, the
// authorization endpoint, the token endpoint and a JWKS endpoint, and signs
// ID tokens with a real RSA key so `openid-client`'s signature verification
// (which refuses symmetric algorithms) has something real to check against.
export function startStubOidc({
  clientId,
  clientSecret,
  issuer,
  user,
  publicOrigin,
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    use: "sig",
    alg: "RS256",
  };

  const codes = new Map();
  const requestLog = [];

  function signIdToken(claims) {
    const header = { alg: "RS256", typ: "JWT" };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = crypto.sign(
      "RSA-SHA256",
      Buffer.from(signingInput),
      privateKey,
    );
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  const server = http.createServer((req, res) => {
    requestLog.push({
      url: req.url,
      method: req.method,
      host: req.headers.host,
    });

    const origin = `http://127.0.0.1:${server.address().port}`;
    const parsed = new URL(req.url, origin);
    // A real provider with a fixed public hostname reports that hostname for
    // every field in its own discovery document, back-channel endpoints
    // included — it has no notion of the internal address callers like this
    // application actually reach it on. `publicOrigin` reproduces exactly
    // that, so a test can drive the stub over its real, listening origin
    // while the document itself never mentions it.
    const documentOrigin = publicOrigin || origin;

    if (parsed.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: documentOrigin,
          authorization_endpoint: `${documentOrigin}/auth`,
          token_endpoint: `${documentOrigin}/token`,
          jwks_uri: `${documentOrigin}/jwks`,
          userinfo_endpoint: `${documentOrigin}/userinfo`,
          end_session_endpoint: `${documentOrigin}/logout`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "profile", "email"],
        }),
      );
      return;
    }

    if (parsed.pathname === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (parsed.pathname === "/auth" && req.method === "GET") {
      const query = parsed.searchParams;
      const code = crypto.randomBytes(16).toString("hex");
      codes.set(code, {
        codeChallenge: query.get("code_challenge"),
        redirectUri: query.get("redirect_uri"),
      });
      const redirectUrl = new URL(query.get("redirect_uri"));
      redirectUrl.searchParams.set("code", code);
      if (query.get("state"))
        redirectUrl.searchParams.set("state", query.get("state"));
      res.writeHead(302, { location: redirectUrl.toString() });
      res.end();
      return;
    }

    if (parsed.pathname === "/token" && req.method === "POST") {
      // Verifies the confidential client's Authorization: Basic header
      // against the clientId/clientSecret this stub was configured with —
      // the one thing a real provider would also reject a mismatch on, and
      // the reason startStubOidc takes a clientSecret at all.
      const authHeader = req.headers.authorization || "";
      const basicMatch = /^Basic (.+)$/.exec(authHeader);
      const decoded = basicMatch
        ? Buffer.from(basicMatch[1], "base64").toString("utf8")
        : "";
      const [authClientId, authClientSecret] = decoded
        .split(":")
        .map(decodeURIComponent);
      if (authClientId !== clientId || authClientSecret !== clientSecret) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_client" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const code = params.get("code");
        const entry = codes.get(code);
        if (!entry) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        const codeVerifier = params.get("code_verifier");
        if (
          entry.codeChallenge &&
          !pkceMatches(codeVerifier, entry.codeChallenge)
        ) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "PKCE mismatch",
            }),
          );
          return;
        }
        codes.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const idToken = signIdToken({
          iss: issuer || origin,
          sub: (user && user.sub) || "test-user",
          aud: clientId,
          exp: now + 3600,
          iat: now,
          name: (user && user.name) || "Test User",
          email: (user && user.email) || "test@example.invalid",
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: crypto.randomBytes(8).toString("hex"),
            token_type: "Bearer",
            expires_in: 3600,
            id_token: idToken,
          }),
        );
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`,
        requestLog,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}
