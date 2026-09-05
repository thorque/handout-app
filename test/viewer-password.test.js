import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import { PROTECTED_SITE } from "./helpers/zip.js";
import { createThrottle } from "../src/throttle.js";

// The real throttle, wired to a recording sleep — the route-level tests
// check the schedule it actually asked for, rather than waiting it out.
function createThrottleForTest(recorded) {
  return createThrottle({
    sleep: async (ms) => {
      recorded.push(ms);
    },
  });
}

const ADDRESS_HOST_SUFFIX = "handout.example.com";
const PASSWORD = "correct-horse-482";

function request(
  baseUrl,
  { method = "GET", path, host, headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const reqHeaders = { ...headers };
    if (host) reqHeaders.Host = host;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function setCookies(res) {
  const raw = res.headers["set-cookie"] || [];
  return raw;
}

function cookieHeaderFrom(setCookieStrings) {
  return setCookieStrings.map((c) => c.split(";")[0]).join("; ");
}

async function publishProtected(t2, { password = PASSWORD } = {}) {
  const cookie = t2.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename: "site.zip",
      content: PROTECTED_SITE,
      contentType: "application/zip",
    },
    { name: "title", value: "Protected Site" },
    { name: "protect", value: "on" },
    { name: "password", value: password },
  ]);
  const res = await fetch(`${t2.baseUrl}/handouts`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": contentType,
    },
    body,
  });
  const json = await res.json();
  assert.strictEqual(res.status, 201, JSON.stringify(json));
  return json.location.split("/").pop();
}

test("without the unlock cookie, GET / on a protected address is 401 with the password page, not the artifact", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const res = await request(t2.baseUrl, {
      path: "/",
      host: `${address}.${ADDRESS_HOST_SUFFIX}`,
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.headers["content-type"], "text/html; charset=utf-8");
    const html = res.body.toString("utf8");
    assert.ok(html.includes(strings["viewer.heading"]));
    assert.ok(html.includes('<form method="post" action="/.handout/password"'));
    assert.ok(!html.includes("Protected entry"));
    assert.strictEqual(res.headers["cache-control"], "no-store");
    assert.strictEqual(res.headers["set-cookie"], undefined);
  } finally {
    await t2.close();
  }
});

test("without the cookie, a sub page, an image and a non-existent path are all 401 — never 404", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;

    const sub = await request(t2.baseUrl, { path: "/sub/page.html", host });
    assert.strictEqual(sub.status, 401);

    const image = await request(t2.baseUrl, {
      path: "/assets/pixel.png",
      host,
    });
    assert.strictEqual(image.status, 401);

    const missing = await request(t2.baseUrl, {
      path: "/nothing/here.html",
      host,
    });
    assert.strictEqual(missing.status, 401);
  } finally {
    await t2.close();
  }
});

test("the right password unlocks: Set-Cookie shape, then / and every path serve without asking again", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const form = `password=${encodeURIComponent(PASSWORD)}`;

    const postRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(postRes.status, 303);
    const cookies = setCookies(postRes);
    const unlock = cookies.find((c) => c.startsWith("handout_unlock="));
    assert.ok(unlock, "expected a handout_unlock cookie");
    assert.match(unlock, /HttpOnly/);
    assert.match(unlock, /Path=\//);
    assert.match(unlock, /SameSite=Lax/i);
    assert.doesNotMatch(unlock, /Domain=/);
    assert.doesNotMatch(unlock, /Secure/);

    const cookieHeader = cookieHeaderFrom(cookies);

    const rootRes = await request(t2.baseUrl, {
      path: "/",
      host,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(rootRes.status, 200);
    assert.strictEqual(rootRes.headers["cache-control"], "private, no-cache");
    const expected = "<html><body>Protected entry</body></html>";
    assert.strictEqual(
      crypto.createHash("sha256").update(rootRes.body).digest("hex"),
      crypto.createHash("sha256").update(expected).digest("hex"),
    );

    const subRes = await request(t2.baseUrl, {
      path: "/sub/page.html",
      host,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(subRes.status, 200);
    assert.strictEqual(
      subRes.headers["content-type"],
      "text/html; charset=utf-8",
    );

    const imgRes = await request(t2.baseUrl, {
      path: "/assets/pixel.png",
      host,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(imgRes.status, 200);
    assert.strictEqual(imgRes.headers["content-type"], "image/png");
  } finally {
    await t2.close();
  }
});

test("Secure is set when SESSION_COOKIE_SECURE is true", async () => {
  const t2 = await buildTestServer({ env: { SESSION_COOKIE_SECURE: "true" } });
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const form = `password=${encodeURIComponent(PASSWORD)}`;

    const postRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    const unlock = setCookies(postRes).find((c) =>
      c.startsWith("handout_unlock="),
    );
    assert.ok(unlock);
    assert.match(unlock, /Secure/);
  } finally {
    await t2.close();
  }
});

test("a wrong password re-renders with the error, both message and framing, and sets no unlock cookie", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const form = `password=${encodeURIComponent("wrong-password")}`;

    const res = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(res.status, 401);
    const html = res.body.toString("utf8");
    assert.ok(html.includes(strings["error.passwordWrong"]));
    assert.ok(html.includes(strings["error.icon"]));
    assert.match(html, /class="viewer-input error"/);
    assert.strictEqual(
      setCookies(res).find((c) => c.startsWith("handout_unlock=")),
      undefined,
    );

    const cssRes = await request(t2.baseUrl, {
      path: "/.handout/assets/handout.css",
      host,
    });
    const css = cssRes.body.toString("utf8");
    const rule = /\.viewer-input\.error\s*\{[^}]*\}/.exec(css);
    assert.ok(rule, "expected a .viewer-input.error rule");
    assert.match(rule[0], /border:/);
    assert.match(rule[0], /box-shadow:/);
  } finally {
    await t2.close();
  }
});

test("an empty password is the same 401 and the same sentence", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const form = "password=";

    const res = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(res.status, 401);
    assert.ok(
      res.body.toString("utf8").includes(strings["error.passwordWrong"]),
    );
  } finally {
    await t2.close();
  }
});

test("a cookie for another address, a tampered cookie, and a stale fingerprint all fail to unlock", async () => {
  const t2 = await buildTestServer();
  try {
    const addressA = await publishProtected(t2);
    const addressB = await publishProtected(t2, {
      password: "other-password-931",
    });

    const form = `password=${encodeURIComponent(PASSWORD)}`;
    const postRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host: `${addressA}.${ADDRESS_HOST_SUFFIX}`,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    const cookies = setCookies(postRes);
    const unlock = cookies.find((c) => c.startsWith("handout_unlock="));
    const cookieHeader = cookieHeaderFrom(cookies);

    // Minted for address A, tried against address B.
    const foreignRes = await request(t2.baseUrl, {
      path: "/",
      host: `${addressB}.${ADDRESS_HOST_SUFFIX}`,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(foreignRes.status, 401);

    // Tampered: flip one character in the cookie's value.
    const [, value] = /handout_unlock=([^;]+)/.exec(unlock);
    const tampered = value.slice(0, -1) + (value.slice(-1) === "a" ? "b" : "a");
    const tamperedRes = await request(t2.baseUrl, {
      path: "/",
      host: `${addressA}.${ADDRESS_HOST_SUFFIX}`,
      headers: { cookie: `handout_unlock=${tampered}` },
    });
    assert.strictEqual(tamperedRes.status, 401);

    // The password changes underneath the cookie: the fingerprint check
    // is what stops it, and it is why the row is read per request.
    await t2.pool.query(
      "update handout set password = 'something-else-123' where id = (select handout_id from address where value = $1)",
      [addressA],
    );
    const staleRes = await request(t2.baseUrl, {
      path: "/",
      host: `${addressA}.${ADDRESS_HOST_SUFFIX}`,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(staleRes.status, 401);
  } finally {
    await t2.close();
  }
});

test("an unprotected handout is never asked for a password and never sets a cookie", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({
      sub: "u1",
      name: "Test User",
      email: "t@example.invalid",
    });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: PROTECTED_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Plain Site" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": contentType,
      },
      body,
    });
    const json = await res.json();
    const address = json.location.split("/").pop();

    const rootRes = await request(t2.baseUrl, {
      path: "/",
      host: `${address}.${ADDRESS_HOST_SUFFIX}`,
    });
    assert.strictEqual(rootRes.status, 200);
    assert.ok(rootRes.body.toString("utf8").includes("Protected entry"));
    assert.strictEqual(rootRes.headers["set-cookie"], undefined);
  } finally {
    await t2.close();
  }
});

test("the remembered path: a navigation sets handout_next, a non-navigation does not, and the correct password redirects there", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;

    const navRes = await request(t2.baseUrl, {
      path: "/sub/page.html",
      host,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    assert.strictEqual(navRes.status, 401);
    const navCookies = setCookies(navRes);
    const nextCookie = navCookies.find((c) => c.startsWith("handout_next="));
    assert.ok(nextCookie, "expected a handout_next cookie on a navigation");

    const imageRes = await request(t2.baseUrl, {
      path: "/sub/page.html",
      host,
      headers: { accept: "image/avif,image/webp,*/*" },
    });
    assert.strictEqual(imageRes.status, 401);
    const imageCookies = setCookies(imageRes);
    assert.strictEqual(
      imageCookies.find((c) => c.startsWith("handout_next=")),
      undefined,
      "a non-navigation (e.g. the browser's own favicon request) must not overwrite the remembered path",
    );

    const form = `password=${encodeURIComponent(PASSWORD)}`;
    const withNext = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
        cookie: cookieHeaderFrom(navCookies),
      },
      body: form,
    });
    assert.strictEqual(withNext.status, 303);
    assert.strictEqual(withNext.headers.location, "/sub/page.html");

    const withoutNext = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(withoutNext.status, 303);
    assert.strictEqual(withoutNext.headers.location, "/");
  } finally {
    await t2.close();
  }
});

test("the target is never taken from the client, in the body or the query", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const addressOrigin = `http://${host}`;

    const bodyForm = `password=${encodeURIComponent(PASSWORD)}&next=https://evil.example.invalid/x`;
    const bodyRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(bodyForm),
      },
      body: bodyForm,
    });
    assert.strictEqual(bodyRes.status, 303);
    assert.strictEqual(
      new URL(bodyRes.headers.location, addressOrigin).origin,
      addressOrigin,
    );

    const queryForm = `password=${encodeURIComponent(PASSWORD)}`;
    const queryRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password?next=https://evil.example.invalid/x",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(queryForm),
      },
      body: queryForm,
    });
    assert.strictEqual(queryRes.status, 303);
    assert.strictEqual(
      new URL(queryRes.headers.location, addressOrigin).origin,
      addressOrigin,
    );
  } finally {
    await t2.close();
  }
});

// Extracts every url("...") from a CSS text.
function urlReferences(css) {
  const refs = new Set();
  const pattern = /url\(["']?([^"')]+)["']?\)/g;
  let match;
  while ((match = pattern.exec(css))) {
    refs.add(match[1]);
  }
  return [...refs];
}

test("the reserved prefix serves Handout's own assets, and following the CSS's own references works on both origins", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;

    const viewerCss = await request(t2.baseUrl, {
      path: "/.handout/assets/handout.css",
      host,
    });
    assert.strictEqual(viewerCss.status, 200);
    assert.strictEqual(
      viewerCss.headers["content-type"],
      "text/css; charset=utf-8",
    );
    const viewerCssText = viewerCss.body.toString("utf8");

    for (const ref of urlReferences(viewerCssText)) {
      const resolved = new URL(
        ref,
        `http://${host}/.handout/assets/handout.css`,
      );
      const assetRes = await request(t2.baseUrl, {
        path: resolved.pathname,
        host,
      });
      assert.strictEqual(
        assetRes.status,
        200,
        `expected 200 for ${resolved.pathname}`,
      );
    }

    const cookie = t2.signSession({
      sub: "u1",
      name: "Test User",
      email: "t@example.invalid",
    });
    const publisherCss = await request(t2.baseUrl, {
      path: "/static/handout.css",
      headers: { cookie },
    });
    assert.strictEqual(publisherCss.status, 200);
    const publisherCssText = publisherCss.body.toString("utf8");
    for (const ref of urlReferences(publisherCssText)) {
      const resolved = new URL(ref, `${t2.baseUrl}/static/handout.css`);
      const assetRes = await request(t2.baseUrl, {
        path: resolved.pathname,
        headers: { cookie },
      });
      assert.strictEqual(
        assetRes.status,
        200,
        `expected 200 for ${resolved.pathname}`,
      );
    }
  } finally {
    await t2.close();
  }
});

test("the reservation is narrow: /handout.css and /static/app.css inside the artifact are the artifact's own bytes", async () => {
  const t2 = await buildTestServer();
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const form = `password=${encodeURIComponent(PASSWORD)}`;
    const postRes = await request(t2.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    const cookieHeader = cookieHeaderFrom(setCookies(postRes));

    const ownCss = await request(t2.baseUrl, {
      path: "/handout.css",
      host,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(ownCss.status, 200);
    assert.ok(ownCss.body.toString("utf8").includes("teal"));

    const staticCss = await request(t2.baseUrl, {
      path: "/static/app.css",
      host,
      headers: { cookie: cookieHeader },
    });
    assert.strictEqual(staticCss.status, 200);
    assert.ok(staticCss.body.toString("utf8").includes("olive"));
  } finally {
    await t2.close();
  }
});

async function postPassword(t2, host, password) {
  const form = `password=${encodeURIComponent(password)}`;
  return request(t2.baseUrl, {
    method: "POST",
    path: "/.handout/password",
    host,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": Buffer.byteLength(form),
    },
    body: form,
  });
}

test("the throttle through the route: three wrong POSTs record [0, 0, 1000], and success clears it", async () => {
  const recorded = [];
  const throttle = createThrottleForTest(recorded);
  const t2 = await buildTestServer({ throttle });
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;

    for (let i = 0; i < 3; i += 1) {
      await postPassword(t2, host, "nope");
    }
    assert.deepStrictEqual(recorded, [0, 0, 1000]);
  } finally {
    await t2.close();
  }
});

test("two wrong, then the correct one, then a wrong one records [0, 0, 0] — cleared on success", async () => {
  const recorded = [];
  const throttle = createThrottleForTest(recorded);
  const t2 = await buildTestServer({ throttle });
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;

    await postPassword(t2, host, "nope");
    await postPassword(t2, host, "nope");
    const correctRes = await postPassword(t2, host, PASSWORD);
    assert.strictEqual(correctRes.status, 303);
    await postPassword(t2, host, "nope");

    assert.deepStrictEqual(recorded, [0, 0, 0]);
  } finally {
    await t2.close();
  }
});

test("the correct password on the first try records nothing", async () => {
  const recorded = [];
  const throttle = createThrottleForTest(recorded);
  const t2 = await buildTestServer({ throttle });
  try {
    const address = await publishProtected(t2);
    const host = `${address}.${ADDRESS_HOST_SUFFIX}`;
    const res = await postPassword(t2, host, PASSWORD);
    assert.strictEqual(res.status, 303);
    assert.deepStrictEqual(recorded, []);
  } finally {
    await t2.close();
  }
});

test("GET /.handout/password renders the page at 401 on a protected address, and 303 to / on an unprotected one", async () => {
  const t2 = await buildTestServer();
  try {
    const protectedAddress = await publishProtected(t2);
    const protectedRes = await request(t2.baseUrl, {
      path: "/.handout/password",
      host: `${protectedAddress}.${ADDRESS_HOST_SUFFIX}`,
    });
    assert.strictEqual(protectedRes.status, 401);
    assert.ok(
      protectedRes.body.toString("utf8").includes(strings["viewer.heading"]),
    );

    const cookie = t2.signSession({
      sub: "u1",
      name: "Test User",
      email: "t@example.invalid",
    });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: PROTECTED_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Plain Site" },
    ]);
    const publishRes = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": contentType,
      },
      body,
    });
    const json = await publishRes.json();
    const plainAddress = json.location.split("/").pop();

    const plainRes = await request(t2.baseUrl, {
      path: "/.handout/password",
      host: `${plainAddress}.${ADDRESS_HOST_SUFFIX}`,
    });
    assert.strictEqual(plainRes.status, 303);
    assert.strictEqual(plainRes.headers.location, "/");
  } finally {
    await t2.close();
  }
});
