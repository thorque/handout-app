import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import { contentTypeFor } from "../src/mime.js";
import { ADDRESS_ALPHABET } from "../src/address.js";
import { containerFor, materialise } from "../src/storage.js";
import { swapState, HandoutGoneError } from "../src/routes/publisher.js";
import {
  TWO_FILE_SITE,
  MULTI_PAGE_WITH_INDEX,
  PROTECTED_SITE,
} from "./helpers/zip.js";

// Deleting a handout: its address stays taken forever and answers a viewer
// with the same "this handout does not exist" a never-issued address gets,
// never an error, and no future handout can ever be given that address. See
// docs/adr/0022-deleting-a-handout-removes-the-row-then-the-bytes.md and
// docs/adr/0023-one-answer-for-an-address-that-shows-nothing.md.

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

async function publish(
  t,
  {
    sub = "u1",
    zip = TWO_FILE_SITE,
    title = "My Site",
    protect,
    password,
  } = {},
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
      content: zip,
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

async function deleteHandout(t, cookie, address) {
  return fetch(`${t.baseUrl}/handouts/${address}/delete`, {
    method: "POST",
    headers: { cookie },
    redirect: "manual",
  });
}

test("the row goes, the address stays, the directory goes", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, { title: "Gone Soon" });

    const res = await deleteHandout(t, cookie, address);
    assert.strictEqual(res.status, 303);
    assert.strictEqual(res.headers.get("location"), "/");

    const handoutCount = await t.pool.query("select count(*) from handout");
    assert.strictEqual(Number(handoutCount.rows[0].count), 0);

    const addressRow = await t.pool.query(
      "select handout_id from address where value = $1",
      [address],
    );
    assert.strictEqual(addressRow.rows.length, 1);
    assert.strictEqual(addressRow.rows[0].handout_id, null);

    await assert.rejects(
      fs.stat(containerFor(t.config, address)),
      (err) => err.code === "ENOENT",
    );
  } finally {
    await t.close();
  }
});

test("the dashboard follows, and so do the count sentence and the empty state", async () => {
  const t = await buildTestServer();
  try {
    const one = await publish(t, { title: "Stays" });
    const two = await publish(t, { title: "Deleted First" });

    await deleteHandout(t, one.cookie, two.address);

    const cookie = one.cookie;
    const afterFirst = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const htmlAfterFirst = await afterFirst.text();
    assert.ok(htmlAfterFirst.includes(strings["dash.countOne"]));
    assert.ok(!htmlAfterFirst.includes("Deleted First"));

    await deleteHandout(t, cookie, one.address);

    const afterSecond = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const htmlAfterSecond = await afterSecond.text();
    assert.ok(htmlAfterSecond.includes(strings["dash.countNone"]));
    assert.ok(htmlAfterSecond.includes(strings["dash.empty"]));
  } finally {
    await t.close();
  }
});

test("criterion 3: a deleted address's entry page says it is gone", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {});
    await deleteHandout(t, cookie, address);

    const host = addressHost(address);
    const res = await request(t.baseUrl, { path: "/", host });
    assert.strictEqual(res.status, 404);
    assert.ok(res.status < 500);
    const body = res.body.toString("utf8");
    assert.ok(body.includes(strings["error.unknownAddress"]));
    // The user struck the address line: nothing on the page may vary with
    // which address this is (docs/adr/0023).
    assert.ok(!body.includes(address));
  } finally {
    await t.close();
  }
});

test("a sub page of a deleted address says the same thing", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });
    await deleteHandout(t, cookie, address);

    const host = addressHost(address);
    for (const urlPath of ["/summary.html", "/assets/app.css"]) {
      const res = await request(t.baseUrl, { path: urlPath, host });
      assert.strictEqual(res.status, 404, `expected 404 for ${urlPath}`);
      assert.ok(
        res.body.toString("utf8").includes(strings["error.unknownAddress"]),
        `expected the no-handout sentence for ${urlPath}`,
      );
    }
  } finally {
    await t.close();
  }
});

test("a deleted address and a never-issued address cannot be told apart", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {});
    await deleteHandout(t, cookie, address);
    const deletedHost = addressHost(address);

    let madeUp = "";
    for (let i = 0; i < 10; i += 1) {
      madeUp += ADDRESS_ALPHABET[0];
    }
    // Never issued: buildTestServer starts each test with an empty database.
    const madeUpHost = addressHost(madeUp);

    const deleted = await request(t.baseUrl, { path: "/", host: deletedHost });
    const neverIssued = await request(t.baseUrl, {
      path: "/",
      host: madeUpHost,
    });

    assert.strictEqual(deleted.status, 404);
    assert.strictEqual(neverIssued.status, 404);
    assert.strictEqual(Buffer.compare(deleted.body, neverIssued.body), 0);
    assert.strictEqual(
      deleted.headers["content-type"],
      neverIssued.headers["content-type"],
    );
    assert.strictEqual(deleted.headers["cache-control"], "no-store");
    assert.strictEqual(neverIssued.headers["cache-control"], "no-store");
    assert.strictEqual(
      deleted.headers["content-length"],
      neverIssued.headers["content-length"],
    );
    assert.ok(!deleted.body.toString("utf8").includes(deletedHost));
    assert.ok(!neverIssued.body.toString("utf8").includes(madeUpHost));
  } finally {
    await t.close();
  }
});

test("an unlock cookie does not survive the delete", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: PROTECTED_SITE,
      protect: true,
      password: "correct-horse-482",
    });

    const host = addressHost(address);
    const form = "password=correct-horse-482";
    const unlock = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(form),
      },
      body: form,
    });
    assert.strictEqual(unlock.status, 303);
    const setCookie = unlock.headers["set-cookie"] || [];
    const unlockSetCookie = setCookie.find((c) =>
      c.startsWith("handout_unlock="),
    );
    assert.ok(unlockSetCookie, "expected a handout_unlock cookie");
    const unlockCookie = unlockSetCookie.split(";")[0];

    await deleteHandout(t, cookie, address);

    const afterDelete = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: unlockCookie },
    });
    assert.strictEqual(afterDelete.status, 404);
    assert.ok(
      afterDelete.body
        .toString("utf8")
        .includes(strings["error.unknownAddress"]),
    );
  } finally {
    await t.close();
  }
});

test("the no-handout page follows every local reference it carries", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {});
    await deleteHandout(t, cookie, address);

    const host = addressHost(address);
    const res = await request(t.baseUrl, { path: "/", host });
    assert.strictEqual(res.status, 404);
    const html = res.body.toString("utf8");

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
      const refRes = await request(t.baseUrl, { path: ref, host });
      assert.strictEqual(refRes.status, 200, `expected 200 for ${ref}`);
      assert.ok(refRes.body.length > 0, `expected non-empty body for ${ref}`);
      assert.strictEqual(
        refRes.headers["content-type"],
        contentTypeFor(ref),
        `content type for ${ref}`,
      );
    }
  } finally {
    await t.close();
  }
});

test("a path that does not exist inside a live handout gets the same page", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: MULTI_PAGE_WITH_INDEX });
    const host = addressHost(address);

    const missing = await request(t.baseUrl, { path: "/nope.html", host });
    assert.strictEqual(missing.status, 404);

    let madeUp = "";
    for (let i = 0; i < 10; i += 1) {
      madeUp += ADDRESS_ALPHABET[0];
    }
    const madeUpHost = addressHost(madeUp);
    const neverIssued = await request(t.baseUrl, {
      path: "/",
      host: madeUpHost,
    });

    assert.strictEqual(neverIssued.status, 404);
    assert.strictEqual(Buffer.compare(missing.body, neverIssued.body), 0);
  } finally {
    await t.close();
  }
});

test("a foreign publisher cannot delete", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { sub: "u1" });
    const otherCookie = t.signSession({
      sub: "u2",
      name: "Other User",
      email: "other@example.invalid",
    });

    const res = await deleteHandout(t, otherCookie, address);
    assert.strictEqual(res.status, 404);
    const body = await res.text();
    assert.ok(body.includes(strings["error.unknownAddress"]));

    const handoutCount = await t.pool.query("select count(*) from handout");
    assert.strictEqual(Number(handoutCount.rows[0].count), 1);
    await assert.doesNotReject(fs.stat(containerFor(t.config, address)));
  } finally {
    await t.close();
  }
});

test("criterion 4: the address is never re-issued", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {});
    await deleteHandout(t, cookie, address);

    await assert.rejects(
      t.pool.query(
        "insert into address (value, handout_id) values ($1, null)",
        [address],
      ),
      (err) => err.code === "23505",
    );

    const addresses = new Set();
    for (let i = 0; i < 25; i += 1) {
      const { address: newAddress } = await publish(t, {
        title: `Handout ${i}`,
      });
      addresses.add(newAddress);
    }
    assert.ok(!addresses.has(address));

    const row = await t.pool.query(
      "select handout_id from address where value = $1",
      [address],
    );
    assert.strictEqual(row.rows[0].handout_id, null);
  } finally {
    await t.close();
  }
});

test("delete during a running upload", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, {});

    const handoutRow = await t.pool.query(
      "select h.id as id from address a join handout h on h.id = a.handout_id where a.value = $1",
      [address],
    );
    const handoutId = handoutRow.rows[0].id;

    const incomingPath = path.join(
      t.config.handoutDataDir,
      "incoming",
      "second.zip",
    );
    await fs.writeFile(incomingPath, TWO_FILE_SITE);
    const materialised = await materialise({
      kind: "zip",
      sourcePath: incomingPath,
      filename: "second.zip",
      config: t.config,
    });

    await t.pool.query("delete from handout where id = $1", [handoutId]);

    const stagingDir = path.join(
      t.config.handoutDataDir,
      "staging",
      materialised.token,
    );
    await assert.doesNotReject(fs.stat(stagingDir));

    await assert.rejects(
      swapState({
        pool: t.pool,
        config: t.config,
        request: { log: { error: () => {} } },
        handoutId,
        address,
        stagingToken: materialised.token,
      }),
      (err) => err instanceof HandoutGoneError,
    );

    await assert.rejects(fs.stat(stagingDir), (err) => err.code === "ENOENT");
    // The container was never touched: this test drives swapState directly
    // against a handout row removed straight through the pool, without
    // going through the delete route's own removeContent call. The refusal
    // is what matters — the staged state was never renamed into it.
    await assert.doesNotReject(fs.stat(containerFor(t.config, address)));
  } finally {
    await t.close();
  }
});

test("criterion 2: the dialog names the handout and its address", async () => {
  const t = await buildTestServer();
  try {
    const one = await publish(t, { title: "Row One" });
    const two = await publish(t, { title: "Row Two" });

    const res = await fetch(`${t.baseUrl}/`, {
      headers: { cookie: one.cookie },
    });
    const html = await res.text();

    for (const { address, title } of [
      { ...one, title: "Row One" },
      { ...two, title: "Row Two" },
    ]) {
      const rowStart = html.indexOf(
        `data-upload-url="/handouts/${address}/state"`,
      );
      assert.ok(rowStart !== -1, `expected a row for ${address}`);
      const rowEnd = html.indexOf("data-handout-row", rowStart + 1);
      const rowHtml = html.slice(
        rowStart,
        rowEnd === -1 ? html.length : rowEnd,
      );
      assert.ok(rowHtml.includes("data-row-delete"));
      assert.ok(rowHtml.includes("handout-row-menu-item-danger"));
      assert.ok(
        rowHtml.includes(`data-delete-url="/handouts/${address}/delete"`),
      );
      assert.ok(rowHtml.includes(`data-delete-title="${title}"`));

      const linkMatch = rowHtml.match(
        /class="handout-row-address"[^>]*>([^<]+)</,
      );
      assert.ok(
        linkMatch,
        `expected the row's own address link for ${address}`,
      );
      assert.ok(
        rowHtml.includes(`data-delete-address="${linkMatch[1]}"`),
        "expected the dialog's address to match the row's own scheme-less host",
      );

      const menuItems = rowHtml.match(/role="menuitem"[^>]*>/g) || [];
      assert.ok(menuItems.length > 0);
      assert.ok(
        menuItems[menuItems.length - 1].includes("data-row-delete"),
        "expected the delete item to be the last menu item",
      );
    }

    assert.strictEqual(
      (html.match(/<dialog[^>]*data-delete-dialog/g) || []).length,
      1,
    );
    assert.ok(html.includes(strings["dash.deleteHeading"]));
    assert.ok(html.includes(strings["dash.deleteConfirm"]));
    assert.ok(html.includes(strings["dash.deleteCancel"]));
    assert.ok(html.includes("<span data-delete-dialog-title></span>"));
    assert.ok(
      html.includes(
        '<span class="delete-dialog-address" data-delete-dialog-address></span>',
      ),
    );
    const formStart = html.indexOf("data-delete-dialog-form");
    const formTagStart = html.lastIndexOf("<form", formStart);
    const formTagEnd = html.indexOf(">", formTagStart);
    const formTag = html.slice(formTagStart, formTagEnd + 1);
    assert.ok(!formTag.includes("action="));
  } finally {
    await t.close();
  }
});

test("an empty dashboard carries no delete dialog", async () => {
  const t = await buildTestServer();
  try {
    const cookie = t.signSession({
      sub: "u1",
      name: "Test User",
      email: "t@example.invalid",
    });
    const res = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const html = await res.text();
    assert.ok(!html.includes("data-delete-dialog"));
  } finally {
    await t.close();
  }
});
