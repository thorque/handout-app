import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings, t as translate } from "../src/views/strings.js";
import { messageText } from "../src/message.js";
import { PASSWORD_MAX_LENGTH } from "../src/password.js";
import { createThrottle } from "../src/throttle.js";
import { TWO_FILE_SITE } from "./helpers/zip.js";

// Issuing a new password for a published handout, from its dashboard row.
// See docs/adr/0025-a-new-password-replaces-the-old-one-and-the-field-never-shows-it.md
// and docs/adr/0026-the-dashboard-row-changes-in-place.md.

const ADDRESS_HOST_SUFFIX = "handout.example.com";

function addressHost(address) {
  return `${address}.${ADDRESS_HOST_SUFFIX}`;
}

// Host-header requests against served content — modelled on
// test/entry-change.test.js's own helper, which is what reaches the content
// path rather than the dashboard's own routes.
function request(
  baseUrl,
  { method = "GET", path: urlPath, host, headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const reqHeaders = { ...headers };
    if (host) reqHeaders.Host = host;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: urlPath,
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
  return res.headers["set-cookie"] || [];
}

function cookieHeaderFrom(setCookieStrings) {
  return setCookieStrings.map((c) => c.split(";")[0]).join("; ");
}

// The real throttle, wired to a recording sleep — modelled on
// test/viewer-password.test.js's own helper, used here only where a wrong
// password's delay would otherwise slow the run.
function createThrottleForTest(recorded) {
  return createThrottle({
    sleep: async (ms) => {
      recorded.push(ms);
    },
  });
}

async function publish(
  t,
  { sub = "u1", title = "My Site", protect, password } = {},
) {
  const cookie = t.signSession({
    sub,
    name: "Test User",
    email: "t@example.invalid",
  });
  const fields = [
    {
      type: "file",
      name: "file",
      filename: "site.zip",
      content: TWO_FILE_SITE,
      contentType: "application/zip",
    },
    { name: "title", value: title },
  ];
  if (protect) {
    fields.push({ name: "protect", value: "on" });
    fields.push({ name: "password", value: password });
  }
  const { body, contentType } = buildMultipart(fields);
  const res = await fetch(`${t.baseUrl}/handouts`, {
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
  return { address: json.location.split("/").pop(), cookie };
}

async function postPassword(t, cookie, address, password) {
  const res = await fetch(`${t.baseUrl}/handouts/${address}/password`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function storedPassword(t, address) {
  const result = await t.pool.query(
    "select h.password as password from address a join handout h on h.id = a.handout_id where a.value = $1",
    [address],
  );
  return result.rows[0] ? result.rows[0].password : undefined;
}

// 1. A new password replaces the old one, the address is untouched, and the
// new one is what the row hands out (criterion 1).
test("a new password replaces the old one, the address is untouched, and the row hands out the new one", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const addressBefore = await t.pool.query(
      "select value, created_at from address where value = $1",
      [address],
    );

    const { res, json } = await postPassword(
      t,
      cookie,
      address,
      "cedar-mist-quill-317",
    );
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.strictEqual(json.password, "cedar-mist-quill-317");
    const expectedHref = `http://${address}.${new URL(t.baseUrl).host}`;
    assert.strictEqual(
      json.message,
      messageText(expectedHref, "cedar-mist-quill-317"),
    );

    assert.strictEqual(
      await storedPassword(t, address),
      "cedar-mist-quill-317",
    );

    const addressAfter = await t.pool.query(
      "select value, created_at from address where value = $1",
      [address],
    );
    assert.strictEqual(addressAfter.rows[0].value, addressBefore.rows[0].value);
    assert.strictEqual(
      addressAfter.rows[0].created_at.toISOString(),
      addressBefore.rows[0].created_at.toISOString(),
    );

    const dashHtml = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    assert.ok(dashHtml.includes('data-copy="cedar-mist-quill-317"'));
    assert.ok(!dashHtml.includes("barn-leaf-dove-945"));
  } finally {
    await t.close();
  }
});

// 2. An open viewer session gets the prompt again and the old password does
// not let it back in (criterion 2).
test("an open viewer session gets the prompt again and the old password does not let it back in", async () => {
  const recorded = [];
  const throttle = createThrottleForTest(recorded);
  const t = await buildTestServer({ throttle });
  try {
    const PASSWORD = "correct-horse-482";
    const { address, cookie } = await publish(t, {
      protect: true,
      password: PASSWORD,
    });
    const host = addressHost(address);

    const form = `password=${encodeURIComponent(PASSWORD)}`;
    const unlockRes = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(unlockRes.status, 303);
    const unlockCookies = setCookies(unlockRes);
    const unlockCookie = cookieHeaderFrom(unlockCookies);
    assert.ok(unlockCookies.some((c) => c.startsWith("handout_unlock=")));

    const before = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: unlockCookie },
    });
    assert.strictEqual(before.status, 200);

    const { res: changeRes } = await postPassword(
      t,
      cookie,
      address,
      "river-slate-heron-208",
    );
    assert.strictEqual(changeRes.status, 200);

    const after = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: unlockCookie },
    });
    assert.strictEqual(after.status, 401);
    assert.ok(after.body.toString("utf8").includes(strings["viewer.heading"]));

    const oldForm = `password=${encodeURIComponent(PASSWORD)}`;
    const oldRes = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(oldForm),
      },
      body: oldForm,
    });
    assert.notStrictEqual(oldRes.status, 303);
    assert.ok(!setCookies(oldRes).some((c) => c.startsWith("handout_unlock=")));
    assert.ok(
      oldRes.body.toString("utf8").includes(strings["error.passwordWrong"]),
    );

    const newForm = `password=${encodeURIComponent("river-slate-heron-208")}`;
    const newRes = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(newForm),
      },
      body: newForm,
    });
    assert.strictEqual(newRes.status, 303);
    const newCookie = cookieHeaderFrom(setCookies(newRes));
    const confirm = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: newCookie },
    });
    assert.strictEqual(confirm.status, 200);
  } finally {
    await t.close();
  }
});

// 3. A free handout becomes protected, and the row says so (criterion 3).
test("a free handout becomes protected, and the row says so", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {});
    const host = addressHost(address);

    const beforeViewer = await request(t.baseUrl, { path: "/", host });
    assert.strictEqual(beforeViewer.status, 200);

    const dashBefore = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    const protectedBadgeBefore =
      /<span[^>]*data-row-badge-protected[^>]*>/.exec(dashBefore)[0];
    const openBadgeBefore = /<span[^>]*data-row-badge-open[^>]*>/.exec(
      dashBefore,
    )[0];
    assert.match(protectedBadgeBefore, /\bhidden\b/);
    assert.doesNotMatch(openBadgeBefore, /\bhidden\b/);

    const { res, json } = await postPassword(
      t,
      cookie,
      address,
      "olive-brook-lark-664",
    );
    assert.strictEqual(res.status, 200, JSON.stringify(json));

    const afterViewer = await request(t.baseUrl, { path: "/", host });
    assert.strictEqual(afterViewer.status, 401);
    assert.ok(
      afterViewer.body.toString("utf8").includes(strings["viewer.heading"]),
    );

    const dashAfter = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    const protectedBadgeAfter = /<span[^>]*data-row-badge-protected[^>]*>/.exec(
      dashAfter,
    )[0];
    const openBadgeAfter = /<span[^>]*data-row-badge-open[^>]*>/.exec(
      dashAfter,
    )[0];
    assert.doesNotMatch(protectedBadgeAfter, /\bhidden\b/);
    assert.match(openBadgeAfter, /\bhidden\b/);
    const copyBothTag = /<button[^>]*data-row-copy-both[^>]*>/.exec(
      dashAfter,
    )[0];
    assert.doesNotMatch(copyBothTag, /\bhidden\b/);
    assert.ok(dashAfter.includes('data-copy="olive-brook-lark-664"'));
  } finally {
    await t.close();
  }
});

// 4. An empty password is refused and the one in force stays.
test("an empty password is refused and the one in force stays", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const { res, json } = await postPassword(t, cookie, address, "");
    assert.strictEqual(res.status, 422);
    assert.strictEqual(json.error, strings["error.newPasswordMissing"]);
    assert.strictEqual(await storedPassword(t, address), "barn-leaf-dove-945");
  } finally {
    await t.close();
  }
});

// 5. A whitespace-only password is refused the same way.
test("a whitespace-only password is refused the same way", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const { res, json } = await postPassword(t, cookie, address, "   ");
    assert.strictEqual(res.status, 422);
    assert.strictEqual(json.error, strings["error.newPasswordMissing"]);
    assert.strictEqual(await storedPassword(t, address), "barn-leaf-dove-945");
  } finally {
    await t.close();
  }
});

// 6. A missing password field is refused, not treated as empty-and-saved.
test("a missing password field is refused, not treated as empty-and-saved", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const res = await fetch(`${t.baseUrl}/handouts/${address}/password`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 422);
    assert.strictEqual(json.error, strings["error.newPasswordMissing"]);
    assert.strictEqual(await storedPassword(t, address), "barn-leaf-dove-945");
  } finally {
    await t.close();
  }
});

// 7. A password over the limit is refused with the limit named.
test("a password over the limit is refused with the limit named, and exactly the limit is accepted", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const tooLong = "a".repeat(PASSWORD_MAX_LENGTH + 1);
    const { res: tooLongRes, json: tooLongJson } = await postPassword(
      t,
      cookie,
      address,
      tooLong,
    );
    assert.strictEqual(tooLongRes.status, 422);
    assert.strictEqual(
      tooLongJson.error,
      translate("error.passwordTooLong", { limit: PASSWORD_MAX_LENGTH }),
    );
    assert.strictEqual(await storedPassword(t, address), "barn-leaf-dove-945");

    const exact = "b".repeat(PASSWORD_MAX_LENGTH);
    const { res: exactRes } = await postPassword(t, cookie, address, exact);
    assert.strictEqual(exactRes.status, 200);
    assert.strictEqual(await storedPassword(t, address), exact);
  } finally {
    await t.close();
  }
});

// 8. Saving the password that is already in force is accepted and open
// sessions survive it.
test("saving the password that is already in force is accepted and open sessions survive it", async () => {
  const t = await buildTestServer();
  try {
    const PASSWORD = "correct-horse-482";
    const { address, cookie } = await publish(t, {
      protect: true,
      password: PASSWORD,
    });
    const host = addressHost(address);

    const form = `password=${encodeURIComponent(PASSWORD)}`;
    const unlockRes = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(unlockRes.status, 303);
    const unlockCookie = cookieHeaderFrom(setCookies(unlockRes));

    const { res } = await postPassword(t, cookie, address, PASSWORD);
    assert.strictEqual(res.status, 200);

    const stillIn = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: unlockCookie },
    });
    assert.strictEqual(stillIn.status, 200);
  } finally {
    await t.close();
  }
});

// 9. Another owner's handout is not reachable.
test("another owner's handout is not reachable", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, {
      sub: "u1",
      protect: true,
      password: "barn-leaf-dove-945",
    });
    const strangerCookie = t.signSession({ sub: "u2" });

    const { res, json } = await postPassword(
      t,
      strangerCookie,
      address,
      "cedar-mist-quill-317",
    );
    assert.strictEqual(res.status, 404);
    assert.strictEqual(json.error, strings["error.unknownAddress"]);
    assert.strictEqual(await storedPassword(t, address), "barn-leaf-dove-945");
  } finally {
    await t.close();
  }
});

// 10. A deleted handout's address answers 404 and stores nothing.
test("a deleted handout's address answers 404 and stores nothing", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const deleteRes = await fetch(`${t.baseUrl}/handouts/${address}/delete`, {
      method: "POST",
      headers: { cookie },
      redirect: "manual",
    });
    assert.strictEqual(deleteRes.status, 303);

    const { res, json } = await postPassword(
      t,
      cookie,
      address,
      "cedar-mist-quill-317",
    );
    assert.strictEqual(res.status, 404);
    assert.strictEqual(json.error, strings["error.unknownAddress"]);

    const addressRow = await t.pool.query(
      "select handout_id from address where value = $1",
      [address],
    );
    assert.strictEqual(addressRow.rows.length, 1);
    assert.strictEqual(addressRow.rows[0].handout_id, null);
  } finally {
    await t.close();
  }
});

// 11. updated_at does not move.
test("updated_at does not move when a password is changed", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      protect: true,
      password: "barn-leaf-dove-945",
    });

    const before = await t.pool.query(
      "select h.updated_at as updated_at from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );

    const { res } = await postPassword(
      t,
      cookie,
      address,
      "cedar-mist-quill-317",
    );
    assert.strictEqual(res.status, 200);

    const after = await t.pool.query(
      "select h.updated_at as updated_at from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    assert.strictEqual(
      after.rows[0].updated_at.toISOString(),
      before.rows[0].updated_at.toISOString(),
    );
  } finally {
    await t.close();
  }
});
