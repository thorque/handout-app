import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import { esc } from "../src/views/layout.js";
import { contentTypeFor } from "../src/mime.js";
import {
  ensureDataDirs,
  paths,
  writePending,
  readPending,
  sweepAbandoned,
  ABANDONED_AFTER_MS,
} from "../src/storage.js";
import { MULTI_PAGE_EXPORT, MANY_PAGES, ENTRYLESS } from "./helpers/zip.js";

function get(baseUrl, urlPath, { host, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const reqHeaders = { ...headers };
    if (host) reqHeaders.Host = host;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: urlPath,
        method: "GET",
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
    req.end();
  });
}

function urlencoded(fields) {
  return new URLSearchParams(fields).toString();
}

async function withTempConfig(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "handout-sweep-"));
  const config = { handoutDataDir: dir };
  try {
    await fn(config);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// The sweep (docs/adr/0012): anything under pending/, staging/ or incoming/
// older than ABANDONED_AFTER_MS is removed; anything newer is untouched. A
// no-op sweep fails the first half, a sweep that takes everything fails the
// second.
test("sweepAbandoned removes only what is older than the constant", async () => {
  await withTempConfig(async (config) => {
    await ensureDataDirs(config);
    const dirs = paths(config);
    const old = new Date(Date.now() - ABANDONED_AFTER_MS - 60_000);

    await writePending(config, "old-token", { owner: "u1", title: "Old" });
    await fs.mkdir(path.join(dirs.staging, "old-token"));
    await fs.utimes(path.join(dirs.pending, "old-token.json"), old, old);
    await fs.utimes(path.join(dirs.staging, "old-token"), old, old);
    await fs.writeFile(path.join(dirs.incoming, "old-upload"), "stale");
    await fs.utimes(path.join(dirs.incoming, "old-upload"), old, old);

    await writePending(config, "fresh-token", {
      owner: "u1",
      title: "Fresh",
    });
    await fs.mkdir(path.join(dirs.staging, "fresh-token"));

    await sweepAbandoned(config);

    assert.strictEqual(await readPending(config, "old-token"), null);
    assert.ok(
      !(await fs.readdir(dirs.staging)).includes("old-token"),
      "expected the old staging directory to be swept",
    );
    assert.ok(
      !(await fs.readdir(dirs.incoming)).includes("old-upload"),
      "expected the old incoming upload to be swept",
    );

    assert.notStrictEqual(await readPending(config, "fresh-token"), null);
    assert.ok(
      (await fs.readdir(dirs.staging)).includes("fresh-token"),
      "expected the fresh staging directory to survive",
    );
  });
});

async function publishAmbiguous(t, { zip = MULTI_PAGE_EXPORT, title } = {}) {
  const cookie = t.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename: "export.zip",
      content: zip,
      contentType: "application/zip",
    },
    { name: "title", value: title },
  ]);
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
  assert.strictEqual(res.status, 200, JSON.stringify(json));
  const token = json.location.split("/").pop();
  return { token, cookie, location: json.location };
}

// The server-side re-check (docs/adr/0012): a value from the form must
// never lead to a path outside the root, and exact membership in
// stagingEntryCandidates is the gate — the only check that also refuses a
// real member of the zip that is not HTML.
test("the entry re-check refuses every bad value and publishes nothing, then a real candidate publishes", async () => {
  const t = await buildTestServer();
  try {
    const { token, cookie } = await publishAmbiguous(t, {
      title: "Bad entries",
    });

    const badEntries = [
      "../../../etc/passwd",
      "uploads/../support.js",
      "support.js",
      "nowhere.html",
    ];

    for (const entry of badEntries) {
      const res = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: urlencoded({ entry }),
      });
      assert.strictEqual(res.status, 422, `expected 422 for ${entry}`);
      const html = await res.text();
      assert.ok(
        html.includes(esc(strings["error.entryNotInZip"])),
        `expected error.entryNotInZip for ${entry}`,
      );
    }

    const addressCount = await t.pool.query("select count(*) from address");
    assert.strictEqual(Number(addressCount.rows[0].count), 0);

    const stagingDirs = await fs.readdir(paths(t.config).staging);
    assert.ok(
      stagingDirs.includes(token),
      "expected the staging directory to still be there",
    );

    const res = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: urlencoded({ entry: "page-two.html" }),
    });
    assert.strictEqual(res.status, 201);
    const json = await res.json();
    assert.match(json.location, /^\/handouts\/[a-km-np-z2-9]{10}$/);
  } finally {
    await t.close();
  }
});

function extractRelativeReferences(html) {
  const refs = new Set();
  const pattern = /(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    const value = match[1];
    if (!/^https?:/.test(value) && !value.startsWith("/")) refs.add(value);
  }
  return [...refs];
}

// The end-to-end run: upload through to fetching the chosen page and every
// local reference that page carries (criterion 2).
test("end-to-end: upload, choose the entry, publish, and every local reference on the chosen page loads", async () => {
  const t = await buildTestServer();
  try {
    const { token, cookie, location } = await publishAmbiguous(t, {
      title: "My Export",
    });
    assert.match(location, /^\/handouts\/entry\/[0-9a-f]{32}$/);

    const handoutCountBefore = await t.pool.query(
      "select count(*) from handout",
    );
    assert.strictEqual(Number(handoutCountBefore.rows[0].count), 0);

    const getRes = await fetch(`${t.baseUrl}${location}`, {
      headers: { cookie },
    });
    assert.strictEqual(getRes.status, 200);
    const html = await getRes.text();

    assert.match(html, /<fieldset[^>]*>[\s\S]*<legend>/);
    const rows = [
      ...html.matchAll(
        /<label for="(entry-\d+)"[^>]*>\s*<input type="radio" name="entry" id="\1" value="([^"]+)"([^>]*)>/g,
      ),
    ];
    assert.deepStrictEqual(
      rows.map((m) => m[2]),
      ["page-one.html", "page-two.html", "uploads/index.html"],
    );
    // D5: nothing is ever preselected.
    assert.ok(
      rows.every((m) => !m[3].includes("checked")),
      "expected no radio to be preselected",
    );
    assert.ok(html.includes("export.zip"));
    assert.ok(html.includes("My Export"));
    // The > 8 filter threshold — absent below it (a three-candidate zip).
    assert.doesNotMatch(html, /data-entry-filter-input/);

    const postRes = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: urlencoded({ entry: "page-two.html" }),
    });
    assert.strictEqual(postRes.status, 201);
    const postJson = await postRes.json();
    const address = postJson.location.split("/").pop();

    const viewRes = await get(t.baseUrl, "/", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(viewRes.status, 200);
    const pageHtml = viewRes.body.toString("utf8");
    assert.ok(pageHtml.includes("Page two"));

    const refs = extractRelativeReferences(pageHtml);
    assert.ok(refs.includes("support.js"));
    assert.ok(refs.includes("uploads/pixel.png"));

    for (const ref of refs) {
      const refRes = await get(t.baseUrl, `/${ref}`, {
        host: `${address}.handout.example.com`,
      });
      assert.strictEqual(refRes.status, 200, `expected 200 for ${ref}`);
      assert.ok(refRes.body.length > 0, `expected non-empty body for ${ref}`);
      assert.strictEqual(refRes.headers["content-type"], contentTypeFor(ref));
    }

    const metaRaw = await fs.readFile(
      path.join(t.config.handoutDataDir, "content", address, ".handout"),
      "utf8",
    );
    const meta = JSON.parse(metaRaw);
    assert.deepStrictEqual(Object.keys(meta).sort(), [
      "entry",
      "filename",
      "kind",
      "root",
    ]);
    assert.strictEqual(meta.entry, "page-two.html");
    assert.strictEqual(meta.root, "");
  } finally {
    await t.close();
  }
});

test("the filter block is present and hidden for eleven candidates, and absent for three", async () => {
  const t = await buildTestServer();
  try {
    const many = await publishAmbiguous(t, {
      zip: MANY_PAGES,
      title: "Many pages",
    });
    const manyHtml = await (
      await fetch(`${t.baseUrl}${many.location}`, {
        headers: { cookie: many.cookie },
      })
    ).text();
    assert.match(manyHtml, /data-entry-filter-input/);
    assert.match(manyHtml, /class="entry-filter" hidden data-entry-filter/);

    const few = await publishAmbiguous(t, { title: "Few pages" });
    const fewHtml = await (
      await fetch(`${t.baseUrl}${few.location}`, {
        headers: { cookie: few.cookie },
      })
    ).text();
    assert.doesNotMatch(fewHtml, /data-entry-filter-input/);
  } finally {
    await t.close();
  }
});

test("GET /handouts/entry/<unknown token> is 404 with error.uploadGone, and so is a different signed-in user's GET", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1" });
    const unknownRes = await fetch(
      `${t.baseUrl}/handouts/entry/${"0".repeat(32)}`,
      { headers: { cookie } },
    );
    assert.strictEqual(unknownRes.status, 404);
    const unknownHtml = await unknownRes.text();
    assert.ok(unknownHtml.includes(strings["error.uploadGone"]));

    const { token } = await publishAmbiguous(t, { title: "Someone else's" });
    const otherCookie = t.signSession({ sub: "u2" });
    const foreignRes = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      headers: { cookie: otherCookie },
    });
    assert.strictEqual(foreignRes.status, 404);
    const foreignHtml = await foreignRes.text();
    assert.ok(foreignHtml.includes(strings["error.uploadGone"]));
  } finally {
    await t.close();
  }
});

test("cancel on the entry-choice screen removes the staging directory and the pending record, and lands on /", async () => {
  const t = await buildTestServer();
  try {
    const { token, cookie } = await publishAmbiguous(t, { title: "Cancel" });

    const res = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: urlencoded({ cancel: "1" }),
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.location, "/");

    assert.strictEqual(await readPending(t.config, token), null);
    const stagingDirs = await fs.readdir(paths(t.config).staging);
    assert.ok(!stagingDirs.includes(token));
  } finally {
    await t.close();
  }
});

test("a zip with no HTML file lands on the rejected screen, which carries error.noHtml and a link back to /handouts/new", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "entryless.zip",
        content: ENTRYLESS,
        contentType: "application/zip",
      },
      { name: "title", value: "No HTML" },
    ]);
    const res = await fetch(`${t.baseUrl}/handouts`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": contentType,
      },
      body,
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.location, "/handouts/rejected");

    const rejectedRes = await fetch(`${t.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    assert.strictEqual(rejectedRes.status, 200);
    const html = await rejectedRes.text();
    assert.ok(html.includes(strings["error.noHtml"]));
    assert.match(
      html,
      /<a class="another-button done-action" href="\/handouts\/new">/,
    );
    // A cancel beside it, to the dashboard — added by the amendment.
    assert.match(html, /<a class="cancel-button" href="\/">/);
  } finally {
    await t.close();
  }
});
