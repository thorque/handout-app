import { ADDRESS_PATTERN } from "./address.js";

function firstValue(headerValue) {
  if (headerValue === undefined || headerValue === null) return undefined;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const [first] = String(raw).split(",");
  return first.trim();
}

export function forwardedHost(headers) {
  const forwarded = firstValue(headers["x-forwarded-host"]);
  if (forwarded) return forwarded.toLowerCase();
  const host = headers.host;
  return host ? host.toLowerCase() : "";
}

export function forwardedProto(headers, connectionScheme = "http") {
  const forwarded = firstValue(headers["x-forwarded-proto"]);
  if (forwarded) return forwarded.toLowerCase();
  return connectionScheme;
}

export function resolveLabel(host) {
  if (!host) return null;
  const withoutPort = host.split(":")[0];
  const labels = withoutPort.split(".");
  if (labels.length < 2) return null;
  const candidate = labels[0].toLowerCase();
  return ADDRESS_PATTERN.test(candidate) ? candidate : null;
}

export function requestOrigin(request) {
  const proto = forwardedProto(request.headers, request.protocol);
  const host = forwardedHost(request.headers);
  return `${proto}://${host}`;
}

export function handoutUrl(request, label) {
  const proto = forwardedProto(request.headers, request.protocol);
  const host = forwardedHost(request.headers);
  return `${proto}://${label}.${host}`;
}

const MAX_RETURN_TO_LENGTH = 2048;

// The one remaining check on the return-path flow, and it runs on the value
// this application is about to emit as a Location, not on anything a caller
// handed in — there is no attacker-writable input left in that flow to
// validate (see requireUser and the auth routes). request.url still
// originates from a link someone can send, so this is defence on the
// output: it asks the exact question the browser will ask when it resolves
// the Location header, twice. The first resolve turns a value like
// "/..//evil.com" into the origin-bearing "//evil.com" that a naive
// same-origin check on the *input* would have missed; re-resolving the
// *result* against this origin is what actually catches it — that is the
// whole point of the second line, and it is also what makes the function
// idempotent, so calling it more than once is harmless.
export function safeReturnTo(value, requestOrigin) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > MAX_RETURN_TO_LENGTH
  ) {
    return "/";
  }
  try {
    const url = new URL(value, requestOrigin);
    if (url.origin !== requestOrigin) return "/";
    const target = url.pathname + url.search;
    if (new URL(target, requestOrigin).origin !== requestOrigin) return "/";
    return target;
  } catch {
    return "/";
  }
}
