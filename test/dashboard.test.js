import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import { messageText } from "../src/message.js";
import { contentTypeFor } from "../src/mime.js";
import { TWO_FILE_SITE } from "./helpers/zip.js";

function sessionCookie(t, claims = {}) {
  return t.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
    ...claims,
  });
}

async function publish(t, sub, fields) {
  const cookie = sessionCookie(t, { sub });
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
  return { res, json, cookie, address: json.location.split("/").pop() };
}

function unescapeAttr(value) {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

async function setUpdatedAt(t, address, iso) {
  await t.pool.query(
    "update handout set updated_at = $1 where id = (select handout_id from address where value = $2)",
    [iso, address],
  );
}

test("GET / renders the list and GET /handouts/new renders the publish form", async () => {
  const t = await buildTestServer();
  try {
    const cookie = sessionCookie(t);
    const dashRes = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const dashHtml = await dashRes.text();
    assert.ok(dashHtml.includes(strings["dash.heading"]));
    assert.ok(!dashHtml.includes("data-publish-form"));

    const formRes = await fetch(`${t.baseUrl}/handouts/new`, {
      headers: { cookie },
    });
    const formHtml = await formRes.text();
    assert.ok(formHtml.includes("data-publish-form"));
    assert.ok(formHtml.includes(strings["drop.pick"]));
  } finally {
    await t.close();
  }
});

test("the dashboard lists only the signed-in owner's handouts", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Owner One A" },
    ]);
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Owner One B" },
    ]);
    const other = await publish(t, "u2", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Owner Two" },
    ]);

    const cookie = sessionCookie(t, { sub: "u1" });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.ok(html.includes("Owner One A"));
    assert.ok(html.includes("Owner One B"));
    assert.ok(!html.includes("Owner Two"));
    assert.ok(!html.includes(other.address));
  } finally {
    await t.close();
  }
});

test("a row carries title, the address without the scheme, a link with it, and a machine-readable UTC stamp", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Stamped Handout" },
    ]);
    await setUpdatedAt(t, address, "2026-09-02T19:44:00Z");

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.match(
      html,
      /<time datetime="2026-09-02T19:44:00\.000Z" data-local-stamp>2 September, 19:44 UTC<\/time>/,
    );
    assert.ok(html.includes(strings["row.lastState"]));
    assert.match(
      html,
      new RegExp(
        `${strings["row.lastState"]} <time datetime="2026-09-02T19:44:00\\.000Z"`,
      ),
    );

    const linkMatch =
      /<a class="handout-row-address" href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(
        html,
      );
    assert.ok(linkMatch, "expected the row's address link");
    assert.match(linkMatch[1], /^http:\/\//);
    assert.strictEqual(linkMatch[2], linkMatch[1].replace(/^https?:\/\//, ""));
  } finally {
    await t.close();
  }
});

test("a very long title is rendered in full and escaped", async () => {
  const t = await buildTestServer();
  try {
    const longTitle = "a".repeat(300) + '<b>&"';
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: longTitle },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.ok(html.includes("a".repeat(300) + "&lt;b&gt;&amp;&quot;"));
    assert.ok(!html.includes('<b>&"'));
  } finally {
    await t.close();
  }
});

test("protection is a word, not only a colour", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected One" },
      { name: "protect", value: "on" },
      { name: "password", value: "correct-horse-482" },
    ]);
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Open One" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // Counted on the badge markup itself, not on every occurrence of the
    // word: "Password" also appears inside the combined handle's own
    // message text, which is unrelated to this criterion.
    const protectedBadges =
      html.match(
        new RegExp(
          `class="handout-row-badge-mark" aria-hidden="true"></span>${strings["row.protected"]}<`,
          "g",
        ),
      ) || [];
    assert.strictEqual(protectedBadges.length, 1);
    const openBadges =
      html.match(
        new RegExp(
          `class="handout-row-badge-mark handout-row-badge-mark-open" aria-hidden="true"></span>${strings["row.open"]}<`,
          "g",
        ),
      ) || [];
    assert.strictEqual(openBadges.length, 1);
    const marks =
      html.match(/class="handout-row-badge-mark[^"]*" aria-hidden="true">/g) ||
      [];
    assert.strictEqual(marks.length, 2);
  } finally {
    await t.close();
  }
});

test("the copy-address handle carries the absolute address and both receipt labels", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Address Handle" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    const buttonMatch =
      /<button[^>]*class="handout-row-copy-button"[^>]*>/.exec(html);
    assert.ok(buttonMatch, "expected the row's copy-address button");
    const button = buttonMatch[0];
    assert.match(button, new RegExp(`data-copy="http://${address}\\.`));
    assert.match(
      button,
      new RegExp(`data-copied-label="${strings["row.addressCopied"]}"`),
    );
    assert.match(
      button,
      new RegExp(
        `data-copy-failed-label="${strings["row.copyAddressFailed"]}"`,
      ),
    );

    assert.ok(
      html.includes(
        `class="copy-field-button-reserve" aria-hidden="true">${strings["row.addressCopied"]}<`,
      ),
    );
  } finally {
    await t.close();
  }
});

test("the ⋯ menu holds exactly the two password items, and only for a protected handout", async () => {
  const t = await buildTestServer();
  try {
    const { address: protectedAddress } = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Protected Menu" },
      { name: "protect", value: "on" },
      { name: "password", value: "barn-leaf-dove-945" },
    ]);
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Open Menu" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.strictEqual(
      (html.match(new RegExp(strings["row.copyBoth"], "g")) || []).length,
      1,
    );
    assert.strictEqual(
      (html.match(new RegExp(strings["row.copyPassword"], "g")) || []).length,
      1,
    );
    assert.ok(html.includes(`data-copy="barn-leaf-dove-945"`));

    const menuItems = html.match(/role="menuitem"/g) || [];
    assert.strictEqual(menuItems.length, 2);
    assert.ok(html.includes(protectedAddress));
  } finally {
    await t.close();
  }
});

test("an open handout on its own carries no ⋯ toggle and no password item", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Open Only" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.ok(!html.includes("data-row-menu-toggle"));
    assert.ok(!html.includes(strings["row.copyPassword"]));
  } finally {
    await t.close();
  }
});

test("the combined handle hands out messageText's text, character for character", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Combined Handle" },
      { name: "protect", value: "on" },
      { name: "password", value: "tiefe-wiese-42" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // The row's own copy-address button carries the same absolute address
    // the combined handle composes its text from.
    const addressButtonMatch =
      /class="handout-row-copy-button"[^>]*data-copy="([^"]+)"/.exec(html);
    assert.ok(addressButtonMatch, "expected the row's address button");
    const fullAddress = addressButtonMatch[1];

    const combinedMatch =
      /class="handout-row-menu-item"[^>]*data-copy="([^"]*)"/.exec(html);
    assert.ok(combinedMatch, "expected the combined handle's data-copy");
    const decoded = unescapeAttr(combinedMatch[1]);
    assert.strictEqual(decoded, messageText(fullAddress, "tiefe-wiese-42"));
  } finally {
    await t.close();
  }
});

test("the ⋯ toggle and its menu are hidden until the script reveals them", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Hidden Menu" },
      { name: "protect", value: "on" },
      { name: "password", value: "correct-horse-482" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    const toggleTag = /<button[^>]*data-row-menu-toggle[^>]*>/.exec(html)[0];
    assert.match(toggleTag, /\bhidden\b/);
    const menuTag = /<div[^>]*data-row-menu[^>]*>/.exec(html)[0];
    assert.match(menuTag, /\bhidden\b/);

    const jsRes = await fetch(`${t.baseUrl}/static/handout.js`);
    const js = await jsRes.text();
    assert.ok(js.includes('querySelectorAll("[data-row-menu-toggle]")'));
    assert.ok(js.includes('querySelectorAll("[data-local-stamp]")'));
  } finally {
    await t.close();
  }
});

test("the newest last state comes first", async () => {
  const t = await buildTestServer();
  try {
    const a = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Order A" },
    ]);
    const b = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Order B" },
    ]);
    const c = await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Order C" },
    ]);

    await setUpdatedAt(t, a.address, "2026-08-01T00:00:00Z");
    await setUpdatedAt(t, c.address, "2026-08-02T00:00:00Z");
    await setUpdatedAt(t, b.address, "2026-08-03T00:00:00Z");

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    const posB = html.indexOf(b.address);
    const posC = html.indexOf(c.address);
    const posA = html.indexOf(a.address);
    assert.ok(posB !== -1 && posC !== -1 && posA !== -1);
    assert.ok(posB < posC);
    assert.ok(posC < posA);
  } finally {
    await t.close();
  }
});

test("an empty dashboard says one sentence and lists no rows", async () => {
  const t = await buildTestServer();
  try {
    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    assert.ok(html.includes(strings["dash.empty"]));
    assert.ok(html.includes(strings["dash.countNone"]));
    assert.ok(!html.includes('class="handout-row"'));
  } finally {
    await t.close();
  }
});

test("the dashboard follows every local reference it carries", async () => {
  const t = await buildTestServer();
  try {
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Ref One" },
      { name: "protect", value: "on" },
      { name: "password", value: "correct-horse-482" },
    ]);
    await publish(t, "u1", [
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "Ref Two" },
    ]);

    const cookie = sessionCookie(t);
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();

    // Only asset-shaped references (a recognisable extension): the
    // dashboard's own page links, e.g. href="/handouts/new", are routes, not
    // assets, and contentTypeFor() only has a meaningful answer for the
    // latter — this is the check that would catch a stylesheet or script
    // the dashboard references but the server does not serve.
    const refs = new Set();
    const attrPattern = /(?:href|src)="([^"]+)"/g;
    let match;
    while ((match = attrPattern.exec(html))) {
      const value = match[1];
      if (
        value.startsWith("/") &&
        !value.startsWith("//") &&
        /\.[a-z0-9]+$/i.test(value)
      ) {
        refs.add(value);
      }
    }
    assert.ok(refs.size > 0);

    for (const ref of refs) {
      const refRes = await fetch(`${t.baseUrl}${ref}`, { headers: { cookie } });
      assert.strictEqual(refRes.status, 200, `expected 200 for ${ref}`);
      const body = await refRes.arrayBuffer();
      assert.ok(body.byteLength > 0, `expected non-empty body for ${ref}`);
      assert.strictEqual(
        refRes.headers.get("content-type"),
        contentTypeFor(ref),
        `content type for ${ref}`,
      );
    }
  } finally {
    await t.close();
  }
});
