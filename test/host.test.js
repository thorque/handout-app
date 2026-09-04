import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLabel,
  forwardedHost,
  requestOrigin,
  handoutUrl,
  safeReturnTo,
} from "../src/host.js";

const cases = [
  ["handout.localhost", null],
  ["localhost", null],
  ["handout-caddy.localhost", null],
  ["abc2defgh3.handout.example.com", "abc2defgh3"],
  ["abc2defgh3.handout.localhost:81", "abc2defgh3"],
  ["ABC2DEFGH3.handout.example.com", "abc2defgh3"],
  ["1234567890.handout.example.com", null],
];

for (const [input, expected] of cases) {
  test(`resolveLabel(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
    assert.strictEqual(resolveLabel(input), expected);
  });
}

test("resolveLabel takes only the first x-forwarded-host value", () => {
  const headers = {
    "x-forwarded-host": "abc2defgh3.example.com, evil.example.com",
  };
  assert.strictEqual(resolveLabel(forwardedHost(headers)), "abc2defgh3");
});

test("requestOrigin and handoutUrl read x-forwarded-proto and x-forwarded-host", () => {
  const request = {
    protocol: "http",
    headers: {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "handout.localhost:81",
    },
  };
  assert.strictEqual(requestOrigin(request), "https://handout.localhost:81");
  assert.strictEqual(
    handoutUrl(request, "abc2defgh3"),
    "https://abc2defgh3.handout.localhost:81",
  );
});

test("requestOrigin falls back to the Host header and connection scheme", () => {
  const request = {
    protocol: "http",
    headers: { host: "localhost:3000" },
  };
  assert.strictEqual(requestOrigin(request), "http://localhost:3000");
});

// ADR 0007 as revised: safeReturnTo is the one remaining check, and it runs
// on the value this application is about to emit as a Location — there is
// no attacker-writable input left in the flow above it (see
// src/session.js's requireUser and src/routes/auth.js). requestOrigin for
// every row below is http://handout.example.com.
//
// /%5Cevil and http:/evil are no longer expected to fall back to "/": both
// resolve onto this same origin (a 404 page, not an open redirect), so a
// function that decodes and pre-parses to force them to "/" would be
// machinery earning nothing — the double-resolve below is what has to hold,
// not a wider net of rejected-looking strings.
const REQUEST_ORIGIN = "http://handout.example.com";

const safeReturnToCases = [
  ["/handouts/abc2defgh3", "/handouts/abc2defgh3"],
  ["/?tab=recent&x=1", "/?tab=recent&x=1"],
  ["https://evil.example.invalid/phish", "/"],
  ["//evil", "/"],
  ["/\\evil", "/"],
  ["/%5Cevil", "/%5Cevil"],
  ["\\/evil", "/"],
  ["http:/evil", "/evil"],
  ["/\t/evil.com", "/"], // the decoded form of %2F%09%2Fevil.com
  ["/\n/evil.com", "/"], // the decoded form of %2F%0A%2Fevil.com; must not throw
];

for (const [input, expected] of safeReturnToCases) {
  test(`safeReturnTo(${JSON.stringify(input)}, origin) === ${JSON.stringify(expected)}`, () => {
    assert.strictEqual(safeReturnTo(input, REQUEST_ORIGIN), expected);
  });
}

// The class every payload list before this one missed: a dot segment the
// URL parser resolves away, landing on a bare "//", which is an authority
// to the browser — `/..//evil.com` becomes `//evil.com` after one resolve.
// A same-origin check on the *input* (or on the once-resolved result) misses
// this; the double-resolve is what catches it, by re-parsing its own output
// exactly as the browser would. Checked two ways per payload: the result
// itself must resolve onto this origin, and running the function again on
// its own output must not change it (idempotence is what makes calling it
// more than once, from more than one place, harmless).
const dotSegmentAndDoubleEncodedPayloads = [
  "/..//evil.com",
  "/.//evil.com",
  "/..%2F%2Fevil.com",
  "%2F..%25252F%25252Fevil.com",
  "%2F%2525252e%2525252e%2F%2Fevil.com",
  "%2F%25252e%25252e%25252F%25252Fevil.com",
];

for (const payload of dotSegmentAndDoubleEncodedPayloads) {
  test(`safeReturnTo(${JSON.stringify(payload)}, origin) lands on this origin and is idempotent`, () => {
    const result = safeReturnTo(payload, REQUEST_ORIGIN);
    assert.strictEqual(new URL(result, REQUEST_ORIGIN).origin, REQUEST_ORIGIN);
    assert.strictEqual(safeReturnTo(result, REQUEST_ORIGIN), result);
  });
}

test("safeReturnTo rejects a repeated query parameter (arrives as an array)", () => {
  assert.strictEqual(safeReturnTo(["/a", "/b"], REQUEST_ORIGIN), "/");
});

test("safeReturnTo rejects non-string and empty values without throwing", () => {
  for (const value of [undefined, null, 42, ""]) {
    assert.strictEqual(safeReturnTo(value, REQUEST_ORIGIN), "/");
  }
});

test("safeReturnTo rejects a value past the length cap", () => {
  assert.strictEqual(safeReturnTo("a".repeat(4096), REQUEST_ORIGIN), "/");
});
