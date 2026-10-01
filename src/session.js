// The signed session cookie described in
// docs/adr/0005-oidc-two-origins-and-stateless-session.md. Signing goes
// through @fastify/cookie's own signer functions directly (rather than the
// per-request decorators) so a session cookie can be minted outside of a
// request too — which is exactly what the test helpers need.
import { sign, unsign } from "@fastify/cookie";

const SESSION_COOKIE = "handout_session";
const OIDC_COOKIE = "handout_oidc";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const OIDC_MAX_AGE_SECONDS = 10 * 60;
const LOGOUT_HINT_COOKIE = "handout_logout_hint";
const LOGOUT_HINT_MAX_AGE_SECONDS = 10 * 60;

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function cookieOptions(config, maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.sessionCookieSecure,
    signed: false, // already signed by hand, see below
    maxAge,
  };
}

// The hint is signed with a key of its own, derived from the session secret and
// a fixed purpose label, so its value is not a valid session cookie.
function logoutHintSecret(config) {
  return `${config.sessionSecret}:logout-hint`;
}

function unsignAndDecode(raw, secret) {
  if (!raw) return null;
  const unsigned = unsign(raw, secret);
  if (!unsigned.valid) return null;
  try {
    return decode(unsigned.value);
  } catch {
    return null;
  }
}

export function readSession(request, config) {
  const claims = unsignAndDecode(
    request.cookies[SESSION_COOKIE],
    config.sessionSecret,
  );
  if (!claims) return null;
  // A session names a person; a payload without a subject is some other
  // signed cookie and never a session (docs/adr/0034).
  if (typeof claims.sub !== "string" || claims.sub === "") return null;
  if (claims.exp && Date.now() / 1000 > claims.exp) return null;
  return claims;
}

export function signSessionValue(config, claims) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  return sign(encode({ ...claims, exp }), config.sessionSecret);
}

export function writeSession(reply, config, claims) {
  reply.setCookie(
    SESSION_COOKIE,
    signSessionValue(config, claims),
    cookieOptions(config, SESSION_MAX_AGE_SECONDS),
  );
}

export function clearSession(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readOidcState(request, config) {
  return unsignAndDecode(request.cookies[OIDC_COOKIE], config.sessionSecret);
}

export function writeOidcState(reply, config, state) {
  reply.setCookie(
    OIDC_COOKIE,
    sign(encode(state), config.sessionSecret),
    cookieOptions(config, OIDC_MAX_AGE_SECONDS),
  );
}

export function clearOidcState(reply) {
  reply.clearCookie(OIDC_COOKIE, { path: "/" });
}

// The cookie carries the ID token of a refused sign-in for one purpose: the
// `id_token_hint` of the sign-out on the refused page. It is not a session and
// `requireUser` never reads it (docs/adr/0034).
export function writeLogoutHint(reply, config, idToken) {
  const exp = Math.floor(Date.now() / 1000) + LOGOUT_HINT_MAX_AGE_SECONDS;
  reply.setCookie(
    LOGOUT_HINT_COOKIE,
    sign(encode({ idToken, exp }), logoutHintSecret(config)),
    cookieOptions(config, LOGOUT_HINT_MAX_AGE_SECONDS),
  );
}

export function readLogoutHint(request, config) {
  const payload = unsignAndDecode(
    request.cookies[LOGOUT_HINT_COOKIE],
    logoutHintSecret(config),
  );
  if (!payload || typeof payload.idToken !== "string") return null;
  if (Date.now() / 1000 > payload.exp) return null;
  return payload.idToken;
}

export function clearLogoutHint(reply) {
  reply.clearCookie(LOGOUT_HINT_COOKIE, { path: "/" });
}

export function requireUser(request, reply, done) {
  const session = readSession(request, request.server.config);
  if (session) {
    request.user = session;
    done();
    return;
  }
  if (request.method === "GET") {
    // The return path never leaves the server and comes back off the
    // client: it goes straight from this request into the signed
    // handout_oidc cookie, and /auth/login redirects with no query
    // parameter at all. There is nothing here for an attacker to write,
    // because nothing round-trips through them (CWE-601's standard
    // mitigation: don't take the value from the client, rather than
    // validate it once it's there).
    writeOidcState(reply, request.server.config, { returnTo: request.url });
    reply.redirect("/auth/login");
    return;
  }
  reply.code(401).send({ error: "Not authenticated" });
}
