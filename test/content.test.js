import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { TWO_FILE_SITE, WRAPPER_SITE } from "./helpers/zip.js";

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

async function publish(
  t,
  { zip = TWO_FILE_SITE, filename = "site.zip", title = "My Site" } = {},
) {
  const cookie = t.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename,
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
  assert.strictEqual(res.status, 201, JSON.stringify(json));
  return { address: json.location.split("/").pop(), cookie };
}

test("GET / on the address host serves the fixture byte-for-byte with no session cookie", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t);
    const res = await get(t.baseUrl, "/", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "text/html; charset=utf-8");
    assert.strictEqual(res.headers["set-cookie"], undefined);

    const expectedHtml = "<html><body>Two file site</body></html>";
    assert.strictEqual(
      crypto.createHash("sha256").update(res.body).digest("hex"),
      crypto.createHash("sha256").update(expectedHtml).digest("hex"),
    );
    assert.ok(!res.body.toString("utf8").includes("handout"));
    assert.ok(!res.body.toString("utf8").includes("<script"));
  } finally {
    await t.close();
  }
});

test("GET /assets/app.css on the address host serves the asset with the right type", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t);
    const res = await get(t.baseUrl, "/assets/app.css", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "text/css; charset=utf-8");
    assert.ok(res.body.toString("utf8").includes("color: red"));
  } finally {
    await t.close();
  }
});

test("a plain publish carries a strong ETag per file, and If-None-Match answers 304", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t);
    const host = `${address}.handout.example.com`;

    const root1 = await get(t.baseUrl, "/", { host });
    assert.strictEqual(root1.status, 200);
    const rootEtag = root1.headers.etag;
    assert.ok(!rootEtag.startsWith("W/"));
    assert.match(rootEtag, /^"[^"]+"$/);

    const asset1 = await get(t.baseUrl, "/assets/app.css", { host });
    assert.strictEqual(asset1.status, 200);
    const assetEtag = asset1.headers.etag;
    assert.ok(!assetEtag.startsWith("W/"));
    assert.match(assetEtag, /^"[^"]+"$/);
    assert.notStrictEqual(rootEtag, assetEtag);

    const root2 = await get(t.baseUrl, "/", { host });
    assert.strictEqual(root2.headers.etag, rootEtag);

    const cached = await get(t.baseUrl, "/", {
      host,
      headers: { "if-none-match": rootEtag },
    });
    assert.strictEqual(cached.status, 304);
    assert.strictEqual(cached.body.length, 0);
    assert.strictEqual(
      cached.headers["cache-control"],
      root1.headers["cache-control"],
    );
    assert.strictEqual(cached.headers.etag, rootEtag);
  } finally {
    await t.close();
  }
});

test("a wrapper-directory zip serves dist/index.html at / and dist/assets/app.css at /assets/app.css", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, {
      zip: WRAPPER_SITE,
      filename: "wrapper.zip",
    });
    const root = await get(t.baseUrl, "/", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(root.status, 200);
    assert.ok(root.body.toString("utf8").includes("Wrapper site"));

    const asset = await get(t.baseUrl, "/assets/app.css", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(asset.status, 200);
    assert.ok(asset.body.toString("utf8").includes("color: blue"));
  } finally {
    await t.close();
  }
});

test("GET /.handout is 404", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t);
    const res = await get(t.baseUrl, "/.handout", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(res.status, 404);
  } finally {
    await t.close();
  }
});

test("a traversal attempt is 404 and reads nothing", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t);
    const res = await get(t.baseUrl, "/../../.env", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(res.status, 404);
  } finally {
    await t.close();
  }
});

test("a PDF publish serves application/pdf with Content-Disposition: inline", async () => {
  const t = await buildTestServer();
  try {
    const pdfBytes = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.from("fake pdf body"),
    ]);
    const cookie = t.signSession({
      sub: "u1",
      name: "Test User",
      email: "t@example.invalid",
    });
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
    assert.strictEqual(res.status, 201);
    const json = await res.json();
    const address = json.location.split("/").pop();

    const pdfRes = await get(t.baseUrl, "/", {
      host: `${address}.handout.example.com`,
    });
    assert.strictEqual(pdfRes.status, 200);
    assert.strictEqual(pdfRes.headers["content-type"], "application/pdf");
    assert.match(
      pdfRes.headers["content-disposition"],
      /inline; filename="report\.pdf"/,
    );
  } finally {
    await t.close();
  }
});

test("an unknown but address-shaped label is 404", async () => {
  const t = await buildTestServer();
  try {
    const res = await get(t.baseUrl, "/", {
      host: "abc2defgh3.handout.example.com",
    });
    assert.strictEqual(res.status, 404);
  } finally {
    await t.close();
  }
});

test("a non-address-shaped host falls through to the publisher interface", async () => {
  const t = await buildTestServer();
  try {
    const res = await get(t.baseUrl, "/", { host: "handout.example.com" });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.location, /^\/auth\/login/);
  } finally {
    await t.close();
  }
});
