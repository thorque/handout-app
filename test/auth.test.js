import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestServer } from "./helpers/app.js";
import { startStubOidc } from "./helpers/oidc-stub.js";
import { strings } from "../src/views/strings.js";

function cookieValue(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const parts = setCookieHeader.split(",");
  for (const part of parts) {
    const pair = part.trim().split(";")[0];
    if (pair.startsWith(`${name}=`)) return pair;
  }
  return null;
}

// The return path is no longer a client-writable query parameter: it goes
// straight from the request that requireUser intercepted into the signed
// handout_oidc cookie, and /auth/login carries no query at all. So walking
// a login now starts at the *protected path itself*, not at /auth/login —
// that interception is where the return path actually enters the flow.
async function walkProtected(t2, protectedPath) {
  const interceptRes = await fetch(`${t2.baseUrl}${protectedPath}`, { redirect: "manual" });
  assert.strictEqual(interceptRes.status, 302, `expected requireUser to redirect for ${protectedPath}`);
  assert.strictEqual(interceptRes.headers.get("location"), "/auth/login");
  const interceptCookie = cookieValue(interceptRes.headers.get("set-cookie"), "handout_oidc");

  return walkLoginFrom(t2, interceptCookie);
}

// Continues a login from a handout_oidc cookie that already carries a
// returnTo (written by requireUser, or — in the tests below that probe the
// ignored query parameter — absent entirely).
async function walkLoginFrom(t2, priorOidcCookie, loginQuery = "") {
  const loginRes = await fetch(`${t2.baseUrl}/auth/login${loginQuery}`, {
    headers: priorOidcCookie ? { cookie: priorOidcCookie } : {},
    redirect: "manual",
  });
  assert.strictEqual(loginRes.status, 302);
  const authorizationUrl = loginRes.headers.get("location");
  const oidcCookie = cookieValue(loginRes.headers.get("set-cookie"), "handout_oidc");

  const authRes = await fetch(authorizationUrl, { redirect: "manual" });
  assert.strictEqual(authRes.status, 302);
  const callbackUrl = authRes.headers.get("location");

  const callbackRes = await fetch(callbackUrl, {
    headers: { cookie: oidcCookie },
    redirect: "manual",
  });
  return callbackRes;
}

test("an unauthenticated GET / 302s to the issuer's authorization endpoint with the right params", async () => {
  const t2 = await buildTestServer();
  try {
    const res = await fetch(`${t2.baseUrl}/`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    const location = new URL(res.headers.get("location"), t2.baseUrl);
    assert.match(location.pathname, /^\/auth\/login/);

    const authRes = await fetch(location.href, { redirect: "manual" });
    assert.strictEqual(authRes.status, 302);
    const authorizationUrl = new URL(authRes.headers.get("location"));
    assert.strictEqual(authorizationUrl.origin, t2.stub.url);
    assert.ok(authorizationUrl.searchParams.get("client_id"));
    assert.ok(authorizationUrl.searchParams.get("state"));
    assert.strictEqual(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
    assert.strictEqual(redirectUri, `${t2.baseUrl}/auth/callback`);
  } finally {
    await t2.close();
  }
});

test("the callback with a matching state sets the session cookie and 302s back to the path requireUser intercepted", async () => {
  const t2 = await buildTestServer();
  try {
    const callbackRes = await walkProtected(t2, "/handouts/abc2defgh3");
    assert.strictEqual(callbackRes.status, 302);
    assert.strictEqual(callbackRes.headers.get("location"), "/handouts/abc2defgh3");
    const sessionCookie = cookieValue(callbackRes.headers.get("set-cookie"), "handout_session");
    assert.ok(sessionCookie, "expected a handout_session cookie");
  } finally {
    await t2.close();
  }
});

test("the callback with a mismatched state is 400 and sets no session", async () => {
  const t2 = await buildTestServer();
  try {
    const loginRes = await fetch(`${t2.baseUrl}/auth/login`, { redirect: "manual" });
    const authorizationUrl = loginRes.headers.get("location");
    const oidcCookie = cookieValue(loginRes.headers.get("set-cookie"), "handout_oidc");

    const authRes = await fetch(authorizationUrl, { redirect: "manual" });
    const callbackUrl = new URL(authRes.headers.get("location"));
    callbackUrl.searchParams.set("state", "wrong-state");

    const callbackRes = await fetch(callbackUrl.href, {
      headers: { cookie: oidcCookie },
      redirect: "manual",
    });
    assert.strictEqual(callbackRes.status, 400);
    assert.strictEqual(callbackRes.headers.get("set-cookie") ? cookieValue(callbackRes.headers.get("set-cookie"), "handout_session") : null, null);
    const body = await callbackRes.text();
    assert.ok(body.includes(strings["error.signInFailed"]));
  } finally {
    await t2.close();
  }
});

test("POST /auth/logout clears the session cookie", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1", name: "Test User", email: "t@example.invalid" });
    const res = await fetch(`${t2.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    assert.strictEqual(res.status, 302);
    const cleared = res.headers.get("set-cookie");
    assert.match(cleared, /handout_session=;/);
  } finally {
    await t2.close();
  }
});

test("a signed-out GET /handouts/:address 302s to /auth/login with no query string, and returns to that same path", async () => {
  const t2 = await buildTestServer();
  try {
    const res = await fetch(`${t2.baseUrl}/handouts/abc2defgh3`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    // No query parameter at all: the return path travels in the signed
    // handout_oidc cookie this response sets, never on the URL.
    assert.strictEqual(res.headers.get("location"), "/auth/login");

    const callbackRes = await walkProtected(t2, "/handouts/abc2defgh3");
    assert.strictEqual(callbackRes.headers.get("location"), "/handouts/abc2defgh3");
  } finally {
    await t2.close();
  }
});

test("the OIDC origin split: front channel goes to the issuer origin, back channel stays on the stub", async () => {
  const issuerOrigin = "http://idp.example.invalid";
  const stub = await startStubOidc({
    clientId: "handout-web",
    clientSecret: "split-secret",
    issuer: `${issuerOrigin}/realms/handout`,
  });
  const t2 = await buildTestServer({
    stub,
    oidcClientId: "handout-web",
    oidcClientSecret: "split-secret",
    env: {
      OIDC_ISSUER_URL: `${issuerOrigin}/realms/handout`,
      OIDC_BACKCHANNEL_URL: stub.url,
    },
  });
  try {
    const loginRes = await fetch(`${t2.baseUrl}/auth/login`, { redirect: "manual" });
    assert.strictEqual(loginRes.status, 302);
    const authorizationUrl = new URL(loginRes.headers.get("location"));
    assert.strictEqual(authorizationUrl.origin, issuerOrigin);
    assert.strictEqual(authorizationUrl.pathname, "/auth");

    const oidcCookie = cookieValue(loginRes.headers.get("set-cookie"), "handout_oidc");

    // The browser cannot actually reach idp.example.invalid, but the stub is
    // listening on the same path (/auth) — walk the flow against the stub
    // directly to prove the callback still validates against the assigned
    // issuer and reaches the token endpoint on the back channel.
    const stubAuthUrl = new URL(authorizationUrl.pathname + authorizationUrl.search, stub.url);
    const authRes = await fetch(stubAuthUrl.href, { redirect: "manual" });
    assert.strictEqual(authRes.status, 302);
    const callbackUrl = authRes.headers.get("location");

    const beforeTokenCalls = stub.requestLog.filter((r) => r.url.startsWith("/token")).length;
    const callbackRes = await fetch(callbackUrl, {
      headers: { cookie: oidcCookie },
      redirect: "manual",
    });
    assert.strictEqual(callbackRes.status, 302, await callbackRes.text());
    const afterTokenCalls = stub.requestLog.filter((r) => r.url.startsWith("/token")).length;
    assert.strictEqual(afterTokenCalls, beforeTokenCalls + 1, "expected the token endpoint to be reached on the stub");

    const sessionCookie = cookieValue(callbackRes.headers.get("set-cookie"), "handout_session");
    assert.ok(sessionCookie, "expected a session cookie after the origin-split flow validated");
  } finally {
    await t2.close();
    await stub.close();
  }
});

test("the back-channel rewrite: a discovery document that reports only the public origin still gets called on OIDC_BACKCHANNEL_URL", async () => {
  // A provider with a fixed public hostname reports that hostname for every
  // field of its own document, back-channel endpoints included — it has no
  // notion of the internal address this application actually reaches it on.
  // With OIDC_ISSUER_URL pointed at that same public origin, the front
  // channel needs no rewriting at all here; only the back channel does, so a
  // deleted or reversed BACK_CHANNEL_FIELDS rewrite is exactly what this test
  // is built to catch — the request would then go out to publicOrigin, which
  // nothing resolves.
  const publicOrigin = "https://id.example.invalid";
  const stub = await startStubOidc({
    clientId: "handout-web",
    clientSecret: "public-secret",
    issuer: `${publicOrigin}/realms/handout`,
    publicOrigin,
  });
  const t2 = await buildTestServer({
    stub,
    oidcClientId: "handout-web",
    oidcClientSecret: "public-secret",
    env: {
      OIDC_ISSUER_URL: `${publicOrigin}/realms/handout`,
      OIDC_BACKCHANNEL_URL: stub.url,
    },
  });
  try {
    const loginRes = await fetch(`${t2.baseUrl}/auth/login`, { redirect: "manual" });
    assert.strictEqual(loginRes.status, 302);
    const authorizationUrl = new URL(loginRes.headers.get("location"));
    assert.strictEqual(authorizationUrl.origin, publicOrigin);

    const oidcCookie = cookieValue(loginRes.headers.get("set-cookie"), "handout_oidc");

    // The browser cannot actually reach id.example.invalid — walk the flow
    // against the stub's real, listening origin instead, the same technique
    // as the origin-split test above.
    const stubAuthUrl = new URL(authorizationUrl.pathname + authorizationUrl.search, stub.url);
    const authRes = await fetch(stubAuthUrl.href, { redirect: "manual" });
    assert.strictEqual(authRes.status, 302);
    const callbackUrl = authRes.headers.get("location");

    const beforeTokenCalls = stub.requestLog.filter((r) => r.url.startsWith("/token")).length;
    const callbackRes = await fetch(callbackUrl, {
      headers: { cookie: oidcCookie },
      redirect: "manual",
    });
    assert.strictEqual(callbackRes.status, 302, await callbackRes.text());
    const afterTokenCalls = stub.requestLog.filter((r) => r.url.startsWith("/token")).length;
    assert.strictEqual(
      afterTokenCalls,
      beforeTokenCalls + 1,
      "expected the token endpoint to be reached on the real back-channel origin, not the public one the document reported",
    );

    const sessionCookie = cookieValue(callbackRes.headers.get("set-cookie"), "handout_session");
    assert.ok(sessionCookie, "expected a session cookie once the back-channel call reached the stub");
  } finally {
    await t2.close();
    await stub.close();
  }
});

// The round-trip is gone: requireUser writes the return path straight into
// the signed handout_oidc cookie at the moment it intercepts a request, and
// /auth/login carries no query parameter at all. So a returnTo passed on
// the query string now has no path into the flow to exploit — this pins
// that shape directly, for every payload the three rounds of review found,
// old string-inspection bypasses and the dot-segment/double-encoding class
// alike. Each one is expected to do *nothing*: the flow completes exactly
// as it would with no query string on /auth/login at all.
const IGNORED_QUERY_PAYLOADS = [
  "https://evil.example.invalid/phish",
  "//evil",
  "/\\evil",
  "/%5Cevil",
  "\\/evil",
  "http:/evil",
  "%2F%09%2Fevil.com",
  "%2F%0A%2Fevil.com",
  "/..//evil.com",
  "/.//evil.com",
  "/..%2F%2Fevil.com",
  "%2F..%25252F%25252Fevil.com",
  "%2F%2525252e%2525252e%2F%2Fevil.com",
  "%2F%25252e%25252e%25252F%25252Fevil.com",
];

test("GET /auth/login?returnTo=<payload> ignores the query entirely, for every payload across all three review rounds", async () => {
  const t2 = await buildTestServer();
  try {
    for (const payload of IGNORED_QUERY_PAYLOADS) {
      // No prior handout_oidc cookie: this simulates a bare link straight to
      // /auth/login?returnTo=..., the shape of the actual phishing link.
      // encodeURIComponent so every payload survives as a syntactically
      // valid query value, regardless of what characters it carries — the
      // whole point of this test is that none of it is ever read anyway.
      const callbackRes = await walkLoginFrom(t2, null, `?returnTo=${encodeURIComponent(payload)}`);
      assert.strictEqual(callbackRes.status, 302, `payload ${payload} must redirect, not error`);
      assert.strictEqual(
        callbackRes.headers.get("location"),
        "/",
        `payload ${payload} must be completely ignored, landing exactly where no returnTo would`,
      );
    }
  } finally {
    await t2.close();
  }
});

test("an attacker-appended returnTo on a legitimate, in-flight login is still ignored", async () => {
  const t2 = await buildTestServer();
  try {
    // requireUser has already written the real return path into the
    // handout_oidc cookie. Appending ?returnTo=... to the /auth/login link
    // before sending it on (the attacker's only remaining lever) must not
    // move the flow away from what that cookie already says.
    const interceptRes = await fetch(`${t2.baseUrl}/handouts/abc2defgh3`, { redirect: "manual" });
    const interceptCookie = cookieValue(interceptRes.headers.get("set-cookie"), "handout_oidc");

    const callbackRes = await walkLoginFrom(
      t2,
      interceptCookie,
      "?returnTo=https://evil.example.invalid/phish",
    );
    assert.strictEqual(callbackRes.status, 302);
    assert.strictEqual(callbackRes.headers.get("location"), "/handouts/abc2defgh3");
  } finally {
    await t2.close();
  }
});

test("GET / unauthenticated redirects to /auth/login with no query string", async () => {
  const t2 = await buildTestServer();
  try {
    const res = await fetch(`${t2.baseUrl}/`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/auth/login");
  } finally {
    await t2.close();
  }
});

test("returnTo keeps a legitimate same-origin path intact", async () => {
  const t2 = await buildTestServer();
  try {
    const callbackRes = await walkProtected(t2, "/handouts/abc2defgh3");
    assert.strictEqual(callbackRes.status, 302);
    assert.strictEqual(callbackRes.headers.get("location"), "/handouts/abc2defgh3");
  } finally {
    await t2.close();
  }
});

test("returnTo keeps the query string intact", async () => {
  const t2 = await buildTestServer();
  try {
    const callbackRes = await walkProtected(t2, "/?tab=recent&x=1");
    assert.strictEqual(callbackRes.status, 302);
    assert.strictEqual(callbackRes.headers.get("location"), "/?tab=recent&x=1");
  } finally {
    await t2.close();
  }
});

// The one remaining check, exercised through the one place it can still
// matter: :address is a route parameter a caller chooses, so requireUser's
// stored returnTo can legitimately contain a dot-segment or double-encoded
// value here, even though it can no longer arrive via a query string. Two
// of the six payloads never reach the route at all (Fastify's own router
// 404s them); the other four do, and the check on the output is what keeps
// their eventual Location on this origin.
const ROUTABLE_DOT_SEGMENT_ADDRESSES = [
  "..%2F%2Fevil.com",
  "..%25252F%25252Fevil.com",
  "%2525252e%2525252e%2F%2Fevil.com",
  "%25252e%25252e%25252F%25252Fevil.com",
];

test("a dot-segment or double-encoded :address survives a real login as a 302 that lands back on this origin", async () => {
  const t2 = await buildTestServer();
  try {
    const requestOrigin = t2.baseUrl;
    for (const address of ROUTABLE_DOT_SEGMENT_ADDRESSES) {
      const callbackRes = await walkProtected(t2, `/handouts/${address}`);
      assert.strictEqual(callbackRes.status, 302, `address ${address} must redirect, not error`);
      const location = callbackRes.headers.get("location");
      const resolved = new URL(location, requestOrigin);
      assert.strictEqual(
        resolved.origin,
        requestOrigin,
        `address ${address} resolved to ${resolved.href}, off this request's origin`,
      );
    }
  } finally {
    await t2.close();
  }
});

test("the two dot-segment addresses Fastify's own router rejects never reach the application at all", async () => {
  const t2 = await buildTestServer();
  try {
    for (const address of ["..//evil.com", ".//evil.com"]) {
      const res = await fetch(`${t2.baseUrl}/handouts/${address}`, { redirect: "manual" });
      assert.strictEqual(res.status, 404, `address ${address} must not reach the route`);
    }
  } finally {
    await t2.close();
  }
});
