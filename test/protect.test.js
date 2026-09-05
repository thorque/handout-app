import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings, t } from "../src/views/strings.js";
import { TWO_FILE_SITE } from "./helpers/zip.js";

function sessionCookie(t2) {
  return t2.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
}

async function publish(t2, fields) {
  const cookie = sessionCookie(t2);
  const { body, contentType } = buildMultipart(fields);
  const res = await fetch(`${t2.baseUrl}/handouts`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": contentType,
    },
    body,
  });
  return { res, json: await res.json(), cookie };
}

test("GET / offers the protect option, checked, with a usable server-rendered suggestion", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = sessionCookie(t2);
    const res = await fetch(`${t2.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.match(
      html,
      /<input type="checkbox" id="protect" name="protect"[^>]*checked/,
    );
    assert.ok(html.includes(strings["form.protectHint"]));
    const passwordMatch = /name="password"[^>]*value="([^"]+)"/.exec(html);
    assert.ok(passwordMatch, 'expected a name="password" input with a value');
    assert.match(passwordMatch[1], /^[a-z]{4,7}(-[a-z]{4,7}){2}-[0-9]{3}$/);
    assert.ok(html.includes(strings["form.passwordSuggest"]));
    assert.ok(
      html.includes(
        `data-label-no-password="${strings["publish.noPassword"]}"`,
      ),
    );
  } finally {
    await t2.close();
  }
});

test("publishing protected stores the password in plain text and the done page carries two copy fields", async () => {
  const t2 = await buildTestServer();
  try {
    const { res, json, cookie } = await publish(t2, [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Site" },
      { name: "protect", value: "on" },
      { name: "password", value: "correct-horse-482" },
    ]);
    assert.strictEqual(res.status, 201, JSON.stringify(json));
    const address = json.location.split("/").pop();

    const row = await t2.pool.query(
      "select password from handout where id = (select handout_id from address where value = $1)",
      [address],
    );
    assert.strictEqual(row.rows[0].password, "correct-horse-482");

    const doneRes = await fetch(`${t2.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    const html = await doneRes.text();
    const copyWrappers = html.match(/data-copy="/g) || [];
    assert.strictEqual(copyWrappers.length, 2);
    assert.ok(html.includes('data-copy="correct-horse-482"'));
    assert.match(
      html,
      new RegExp(`data-copy-label>${strings["done.copy"]}</span>`),
    );
    assert.match(
      html,
      new RegExp(`data-copy-label>${strings["done.copyPassword"]}</span>`),
    );
    assert.ok(html.includes(strings["done.passwordCopied"]));
    assert.ok(html.includes(strings["done.leadProtected"]));
  } finally {
    await t2.close();
  }
});

test("publishing without protect stays unprotected: null password, one copy field, the plain lead", async () => {
  const t2 = await buildTestServer();
  try {
    const { res, json, cookie } = await publish(t2, [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Plain Site" },
    ]);
    assert.strictEqual(res.status, 201, JSON.stringify(json));
    const address = json.location.split("/").pop();

    const row = await t2.pool.query(
      "select password from handout where id = (select handout_id from address where value = $1)",
      [address],
    );
    assert.strictEqual(row.rows[0].password, null);

    const doneRes = await fetch(`${t2.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    const html = await doneRes.text();
    const copyWrappers = html.match(/data-copy="/g) || [];
    assert.strictEqual(copyWrappers.length, 1);
    assert.ok(html.includes(strings["done.lead"]));
  } finally {
    await t2.close();
  }
});

test("protect on with an empty password is 422, refuses before content is promoted", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = sessionCookie(t2);
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Site" },
      { name: "protect", value: "on" },
      { name: "password", value: "" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    });
    assert.strictEqual(res.status, 422);
    const html = await res.text();
    assert.ok(html.includes(strings["error.passwordMissing"]));
    assert.ok(html.includes(strings["error.icon"]));

    const contentDir = `${t2.config.handoutDataDir}/content`;
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(contentDir).catch(() => []);
    assert.strictEqual(entries.length, 0);
  } finally {
    await t2.close();
  }
});

test("protect on with a 201-character password is 422", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = sessionCookie(t2);
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Site" },
      { name: "protect", value: "on" },
      { name: "password", value: "a".repeat(201) },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    });
    assert.strictEqual(res.status, 422);
    const html = await res.text();
    assert.ok(html.includes(t("error.passwordTooLong", { limit: 200 })));
  } finally {
    await t2.close();
  }
});

test("GET /password-suggestion returns different suggestions with a session", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = sessionCookie(t2);
    const seen = new Set();
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${t2.baseUrl}/password-suggestion`, {
        headers: { cookie, accept: "application/json" },
      });
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get("content-type"), /application\/json/);
      const json = await res.json();
      assert.match(json.password, /^[a-z]{4,7}(-[a-z]{4,7}){2}-[0-9]{3}$/);
      seen.add(json.password);
    }
    assert.ok(
      seen.size >= 2,
      "expected at least two distinct suggestions over ten calls",
    );
  } finally {
    await t2.close();
  }
});

test("GET /password-suggestion without a session redirects to sign in, no password leaked", async () => {
  const t2 = await buildTestServer();
  try {
    const res = await fetch(`${t2.baseUrl}/password-suggestion`, {
      redirect: "manual",
    });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get("location"), /^\/auth\/login/);
    const body = await res.text();
    assert.ok(!body.includes("password"));
  } finally {
    await t2.close();
  }
});

// Both copy handles hold the width of every label any handle can show, so they
// come out the same width and neither resizes when its receipt appears for two
// seconds. Asserted on the markup rather than on a rendered width, in the same
// way as the other structural checks in this suite; the CSS rules that make the
// reserves carry the width are asserted in test/publish.test.js.
test("every copy handle reserves the width of every copy label", async () => {
  const t2 = await buildTestServer();
  try {
    const { json, cookie } = await publish(t2, [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Site" },
      { name: "protect", value: "on" },
      { name: "password", value: "barn-leaf-dove-945" },
    ]);

    const doneRes = await fetch(`${t2.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    const html = await doneRes.text();

    const labels = [
      strings["done.copy"],
      strings["done.copied"],
      strings["done.copyPassword"],
      strings["done.passwordCopied"],
    ];
    const reserves =
      html.match(/class="copy-field-button-reserve" aria-hidden="true">/g) ||
      [];
    assert.strictEqual(
      reserves.length,
      labels.length * 2,
      "expected both handles to reserve all four labels",
    );
    for (const label of labels) {
      const occurrences =
        html.match(
          new RegExp(
            `copy-field-button-reserve" aria-hidden="true">${label}<`,
            "g",
          ),
        ) || [];
      assert.strictEqual(
        occurrences.length,
        2,
        `expected both handles to reserve "${label}"`,
      );
    }

    // The failure sentence is the one label that is not reserved: reserving it
    // would widen both buttons permanently for a path that almost never runs.
    assert.ok(
      !html.includes(
        `class="copy-field-button-reserve" aria-hidden="true">${strings["done.copyFailed"]}<`,
      ),
    );
  } finally {
    await t2.close();
  }
});

// The address opens in a new tab; the password never does. The component
// decides that by sniffing the value for http(s) (Kopierfeld.dc.html), the view
// decides it per field - so a password that looks like a URL stays plain text,
// which is exactly what this test pins.
test("the address is a link that opens in a new tab, the password never is", async () => {
  const t2 = await buildTestServer();
  try {
    const { json, cookie } = await publish(t2, [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Site" },
      { name: "protect", value: "on" },
      { name: "password", value: "https://not-a-link.example" },
    ]);

    const doneRes = await fetch(`${t2.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    const html = await doneRes.text();

    const anchors = html.match(/<a class="copy-field-value[^>]*>/g) || [];
    assert.strictEqual(
      anchors.length,
      1,
      "expected exactly one linked value: the address",
    );
    const anchor = anchors[0];
    const address = `http://${json.location.split("/").pop()}.`;
    assert.ok(
      anchor.includes(`href="${address}`),
      `expected the anchor to point at the address, got ${anchor}`,
    );
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noreferrer"/);

    // The password sits in the plain element, and nowhere in an href.
    assert.ok(
      html.includes(
        '<code class="copy-field-value">https://not-a-link.example</code>',
      ),
    );
    assert.ok(!html.includes('href="https://not-a-link.example"'));

    const cssRes = await fetch(`${t2.baseUrl}/static/handout.css`, {
      headers: { cookie },
    });
    const css = await cssRes.text();
    const linkRule = /\.copy-field-link\s*\{[^}]*\}/.exec(css);
    assert.ok(linkRule);
    assert.match(linkRule[0], /text-decoration:\s*underline/);
    assert.match(linkRule[0], /text-underline-offset:\s*2px/);
  } finally {
    await t2.close();
  }
});
