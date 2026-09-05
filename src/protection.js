// The whole password gate, per docs/adr/0010: content.js, routes/viewer.js
// and app.js all share this one implementation, so the reserved prefix, the
// unlock cookie and the remembered-path cookie have exactly one definition
// each.
import { createHash } from "node:crypto";
import { sign, unsign } from "@fastify/cookie";

export const VIEWER_PREFIX = "/.handout/";
export const VIEWER_ASSET_PREFIX = "/.handout/assets";
export const UNLOCK_COOKIE = "handout_unlock";
export const NEXT_COOKIE = "handout_next";

const UNLOCK_MAX_AGE_SECONDS = 12 * 60 * 60;
const NEXT_MAX_AGE_SECONDS = 10 * 60;

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

// Deliberately its own function, not a reuse of session.js's private
// cookieOptions: the unlock and next cookies are separate from the
// publisher's session cookies on purpose, and a shared helper is exactly
// how they would drift into one. Never sets `domain` — see the ADR.
function cookieOptions(config, maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.sessionCookieSecure,
    signed: false,
    maxAge,
  };
}

function unsignAndDecode(raw, config) {
  if (!raw) return null;
  const unsigned = unsign(raw, config.sessionSecret);
  if (!unsigned.valid) return null;
  try {
    return decode(unsigned.value);
  } catch {
    return null;
  }
}

export function isViewerPath(url) {
  const path = String(url).split("?")[0];
  return path.startsWith(VIEWER_PREFIX);
}

export async function loadProtection(pool, address) {
  const result = await pool.query(
    `select h.password as password
     from address a
     join handout h on h.id = a.handout_id
     where a.value = $1`,
    [address],
  );
  return result.rows[0] || null;
}

export function unlockFingerprint(password) {
  return createHash("sha256")
    .update(password, "utf8")
    .digest("hex")
    .slice(0, 16);
}

export function isUnlocked(request, config, address, password) {
  const claims = unsignAndDecode(request.cookies[UNLOCK_COOKIE], config);
  if (!claims) return false;
  if (claims.address !== address) return false;
  if (claims.fingerprint !== unlockFingerprint(password)) return false;
  if (!claims.exp || Date.now() / 1000 > claims.exp) return false;
  return true;
}

export function writeUnlock(reply, config, address, password) {
  const exp = Math.floor(Date.now() / 1000) + UNLOCK_MAX_AGE_SECONDS;
  const claims = { address, fingerprint: unlockFingerprint(password), exp };
  reply.setCookie(
    UNLOCK_COOKIE,
    sign(encode(claims), config.sessionSecret),
    cookieOptions(config, UNLOCK_MAX_AGE_SECONDS),
  );
}

export function readNext(request, config) {
  const claims = unsignAndDecode(request.cookies[NEXT_COOKIE], config);
  return claims ? claims.url : undefined;
}

export function writeNext(reply, config, url) {
  reply.setCookie(
    NEXT_COOKIE,
    sign(encode({ url }), config.sessionSecret),
    cookieOptions(config, NEXT_MAX_AGE_SECONDS),
  );
}

export function clearNext(reply) {
  reply.clearCookie(NEXT_COOKIE, { path: "/" });
}
