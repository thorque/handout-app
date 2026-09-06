import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import {
  resolveState,
  readMetaFrom,
  writeStatePointer,
  setStateEntry,
} from "../src/storage.js";
import {
  TWO_FILE_SITE,
  SECOND_STATE,
  MULTI_PAGE_WITH_INDEX,
} from "./helpers/zip.js";

// Changing a published handout's entry page from its dashboard row, without
// a re-upload. See docs/adr/0021-a-live-states-entry-may-be-rewritten-in-
// place.md.

const ADDRESS_HOST_SUFFIX = "handout.example.com";

function addressHost(address) {
  return `${address}.${ADDRESS_HOST_SUFFIX}`;
}

// Host-header requests against served content — modelled on
// test/update.test.js's own helper, which is what reaches the content path
// rather than the dashboard's own routes.
function request(
  baseUrl,
  { method = "GET", path: urlPath, host, headers = {}, agent } = {},
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
        agent,
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

async function publish(
  t,
  { zip = MULTI_PAGE_WITH_INDEX, title = "My Site", protect, password } = {},
) {
  const cookie = t.signSession({
    sub: "u1",
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

async function publishPdf(t) {
  const cookie = t.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
  const pdfBytes = Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from("fake pdf body"),
  ]);
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename: "report.pdf",
      content: pdfBytes,
      contentType: "application/pdf",
    },
    { name: "title", value: "Report" },
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
  assert.strictEqual(res.status, 201, JSON.stringify(json));
  return { address: json.location.split("/").pop(), cookie };
}

async function postState(t, cookie, address, zip) {
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename: "site.zip",
      content: zip,
      contentType: "application/zip",
    },
  ]);
  const res = await fetch(`${t.baseUrl}/handouts/${address}/state`, {
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
  return json;
}

async function getEntry(t, cookie, address) {
  const res = await fetch(`${t.baseUrl}/handouts/${address}/entry`, {
    headers: { cookie, accept: "application/json" },
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function postEntry(t, cookie, address, entry) {
  const res = await fetch(`${t.baseUrl}/handouts/${address}/entry`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ entry }),
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

// T1 — a PDF row does not offer the item.
test("a PDF row offers neither the menu item nor a panel", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publishPdf(t);
    const dashHtml = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    assert.ok(!dashHtml.includes(strings["row.changeEntry"]));
    assert.ok(!dashHtml.includes("data-row-entry-panel"));
    assert.ok(dashHtml.includes(address));
  } finally {
    await t.close();
  }
});

// T2 — a single-HTML zip does not offer it.
test("a single-HTML zip's row offers neither the menu item nor a panel", async () => {
  const t = await buildTestServer();
  try {
    const { cookie } = await publish(t, { zip: TWO_FILE_SITE });
    const dashHtml = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    assert.ok(!dashHtml.includes(strings["row.changeEntry"]));
    assert.ok(!dashHtml.includes("data-row-entry-panel"));
  } finally {
    await t.close();
  }
});

// T3 — a multi-page zip does offer it. The radio rows themselves are
// fetched, not server-rendered (decision 2, docs/adr/0021), so the
// per-row-uniqueness check falls on what the skeleton *does* render
// server-side: the filter's own id, built from the same group prefix
// (`entry-<address>-filter`), and the row's own data-entry-url.
test("a multi-page zip's row offers the menu item and the panel skeleton", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });
    const dashHtml = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    assert.ok(dashHtml.includes(strings["row.changeEntry"]));
    assert.ok(dashHtml.includes("data-row-entry-panel"));
    assert.ok(dashHtml.includes(strings["row.entryLegend"]));
    assert.ok(dashHtml.includes(strings["row.entryNote"]));
    assert.ok(dashHtml.includes(`entry-${address}-filter`));
    assert.ok(dashHtml.includes(`data-entry-url="/handouts/${address}/entry"`));
  } finally {
    await t.close();
  }
});

// T4 — the list route reads the live content.
test("GET /handouts/:address/entry reads the live content and checks ownership", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });

    const { res, json } = await getEntry(t, cookie, address);
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.deepStrictEqual(json, {
      entry: "index.html",
      candidates: ["index.html", "summary.html"],
    });

    const strangerCookie = t.signSession({ sub: "u2" });
    const { res: strangerRes, json: strangerJson } = await getEntry(
      t,
      strangerCookie,
      address,
    );
    assert.strictEqual(strangerRes.status, 404);
    assert.strictEqual(strangerJson.error, strings["error.unknownAddress"]);
  } finally {
    await t.close();
  }
});

// T5 — the re-check.
test("the server-side re-check refuses a non-HTML member, a traversal, and no choice — and never writes", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });

    const nonHtml = await postEntry(t, cookie, address, "assets/app.css");
    assert.strictEqual(nonHtml.res.status, 422);
    assert.strictEqual(nonHtml.json.error, strings["error.entryNotInZip"]);

    const traversal = await postEntry(
      t,
      cookie,
      address,
      "../../../etc/passwd",
    );
    assert.strictEqual(traversal.res.status, 422);
    assert.strictEqual(traversal.json.error, strings["error.entryNotInZip"]);

    const empty = await postEntry(t, cookie, address, "");
    assert.strictEqual(empty.res.status, 422);
    assert.strictEqual(empty.json.error, strings["error.entryNotChosen"]);

    const state = await resolveState(t.config, address);
    const meta = await readMetaFrom(state.dir);
    assert.strictEqual(meta.entry, "index.html");
  } finally {
    await t.close();
  }
});

// T6 — the change takes effect at the same address, past a warm cache. The
// second acceptance criterion.
test("a viewer with a warm cache gets the new entry page, not the old one", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });
    const host = addressHost(address);

    const first = await request(t.baseUrl, { path: "/", host });
    assert.strictEqual(first.status, 200);
    const etag = first.headers.etag;
    assert.ok(etag);
    assert.ok(first.body.toString("utf8").includes("Overview page"));

    const { res: postRes } = await postEntry(
      t,
      cookie,
      address,
      "summary.html",
    );
    assert.strictEqual(postRes.status, 200);

    const revalidated = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { "if-none-match": etag },
    });
    assert.strictEqual(revalidated.status, 200);
    assert.ok(revalidated.body.toString("utf8").includes("Summary page"));
    assert.notStrictEqual(revalidated.headers.etag, etag);
  } finally {
    await t.close();
  }
});

// T7 — nothing else moves. The fourth acceptance criterion.
test("the address, the password and the last-state time are unchanged by an entry change", async () => {
  const t = await buildTestServer();
  try {
    const password = "correct-horse-482";
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
      protect: true,
      password,
    });

    const before = await t.pool.query(
      "select h.updated_at as updated_at, h.password as password from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    const beforeUpdatedAt = before.rows[0].updated_at.toISOString();

    const dashBefore = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    const stampMatch = dashBefore.match(/datetime="([^"]+)"/);
    assert.ok(stampMatch);

    const { res: postRes } = await postEntry(
      t,
      cookie,
      address,
      "summary.html",
    );
    assert.strictEqual(postRes.status, 200);

    const after = await t.pool.query(
      "select h.updated_at as updated_at, h.password as password from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    assert.strictEqual(after.rows[0].updated_at.toISOString(), beforeUpdatedAt);
    assert.strictEqual(after.rows[0].password, password);

    const addressRows = await t.pool.query(
      "select value from address where handout_id = (select id from handout where owner = $1)",
      ["u1"],
    );
    assert.strictEqual(addressRows.rows.length, 1);
    assert.strictEqual(addressRows.rows[0].value, address);

    const dashAfter = await (
      await fetch(`${t.baseUrl}/`, { headers: { cookie } })
    ).text();
    assert.ok(dashAfter.includes(stampMatch[0]));
  } finally {
    await t.close();
  }
});

// T8 — reserved prefix. The atomic write's temporary sibling
// (.handout.<random>) must never be reachable, and neither must .handout
// itself — docs/adr/0021 widens the reserved basename from the two exact
// names to the whole ".handout" prefix.
test("a .handout-prefixed file inside a live state is never served", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: TWO_FILE_SITE });
    const state = await resolveState(t.config, address);
    await fs.writeFile(path.join(state.dir, ".handout.tmp"), "leftover");

    const tmp = await request(t.baseUrl, {
      path: "/.handout.tmp",
      host: addressHost(address),
    });
    assert.strictEqual(tmp.status, 404);

    const handout = await request(t.baseUrl, {
      path: "/.handout",
      host: addressHost(address),
    });
    assert.strictEqual(handout.status, 404);
  } finally {
    await t.close();
  }
});

// T9 — a new state makes the old choice refusable.
test("a new state landing between the fetch and the save makes the old choice refusable", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });

    const { res: listRes } = await getEntry(t, cookie, address);
    assert.strictEqual(listRes.status, 200);

    await postState(t, cookie, address, SECOND_STATE);

    const { res, json } = await postEntry(t, cookie, address, "summary.html");
    assert.strictEqual(res.status, 422);
    assert.strictEqual(json.error, strings["error.entryNotInZip"]);
  } finally {
    await t.close();
  }
});

// T10 — content gone under a live pointer.
test("GET and POST both 404 when the pointer names no directory", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });
    await writeStatePointer(t.config, address, "deadbeefdeadbeef00000000");

    const { res: getRes, json: getJson } = await getEntry(t, cookie, address);
    assert.strictEqual(getRes.status, 404);
    assert.strictEqual(getJson.error, strings["error.unknownAddress"]);

    const { res: postRes, json: postJson } = await postEntry(
      t,
      cookie,
      address,
      "summary.html",
    );
    assert.strictEqual(postRes.status, 404);
    assert.strictEqual(postJson.error, strings["error.unknownAddress"]);
  } finally {
    await t.close();
  }
});

// T11 — setStateEntry on a removed state rejects.
test("setStateEntry rejects rather than recreating a removed state", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: TWO_FILE_SITE });
    const state = await resolveState(t.config, address);
    await fs.rm(state.dir, { recursive: true, force: true });

    await assert.rejects(() => setStateEntry(state.dir, "index.html"));
  } finally {
    await t.close();
  }
});

// T12 — the artifact is untouched.
test("the artifact's own files are untouched by an entry change", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, {
      zip: MULTI_PAGE_WITH_INDEX,
    });
    const host = addressHost(address);

    const { res: postRes } = await postEntry(
      t,
      cookie,
      address,
      "summary.html",
    );
    assert.strictEqual(postRes.status, 200);

    const indexRes = await request(t.baseUrl, { path: "/index.html", host });
    assert.strictEqual(indexRes.status, 200);
    assert.ok(indexRes.body.toString("utf8").includes("Overview page"));
  } finally {
    await t.close();
  }
});

// The 409 branch (error.entryStateMoved) is implemented but not covered by a
// deterministic test here: reaching it needs the pointer to move between the
// re-check and the write *inside one request*, which this suite has no hook
// for and which is not worth adding one for. T9 and T10 above cover the two
// reachable halves of the same race — the list read stale, and the content
// gone outright.
