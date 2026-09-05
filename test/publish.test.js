import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings, t } from "../src/views/strings.js";
import { ADDRESS_PATTERN } from "../src/address.js";
import { TWO_FILE_SITE, ENTRYLESS, TRAVERSAL } from "./helpers/zip.js";

function rawRequest(baseUrl, { method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("the happy path: multipart POST returns 303 to /handouts/<10 chars>, and the done page carries the address", async () => {
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
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "My Site" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
      redirect: "manual",
    });
    assert.strictEqual(res.status, 303);
    const location = res.headers.get("location");
    assert.match(location, /^\/handouts\/[a-km-np-z2-9]{10}$/);
    const address = location.split("/").pop();
    assert.match(address, ADDRESS_PATTERN);

    const doneRes = await fetch(`${t2.baseUrl}${location}`, {
      headers: { cookie },
    });
    assert.strictEqual(doneRes.status, 200);
    const html = await doneRes.text();
    assert.ok(
      html.includes(`data-copy="http://`),
      "expected a data-copy attribute with the absolute address",
    );
    assert.ok(
      html.includes(address),
      "expected the done page to carry the address",
    );
    assert.match(
      html,
      new RegExp(`data-copy-label>${strings["done.copy"]}</span>`),
    );
  } finally {
    await t2.close();
  }
});

// Kopierfeld (design-sources/Kopierfeld.dc.html) had never been read before
// this audit — the done page was built from a description instead. The left
// column had no class at all, exactly the data-drop-empty fault: an element
// the markup needs to style but never gave a hook to. Structural rather than
// a rendering check, per the same technique used for the header and the
// drop area's wrappers.
test("the done page's Kopierfeld matches the component: a classed, shrinkable left column", async () => {
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
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "My Site" },
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
    const { location } = await res.json();
    const doneRes = await fetch(`${t2.baseUrl}${location}`, {
      headers: { cookie },
    });
    const html = await doneRes.text();

    // The label and the value both live inside a classed column, not a bare
    // <div> — without it, min-width:0 has nothing to attach to and a long
    // address can never shrink far enough for its own ellipsis to engage.
    const columnMatch =
      /<div class="([^"]+)">\s*<span class="copy-field-label"/.exec(html);
    assert.ok(
      columnMatch,
      "expected a classed element wrapping the label and value",
    );
    const columnClass = columnMatch[1];

    const cssRes = await fetch(`${t2.baseUrl}/static/handout.css`, {
      headers: { cookie },
    });
    const css = await cssRes.text();

    const columnRule = new RegExp(`\\.${columnClass}\\s*\\{[^}]*\\}`).exec(css);
    assert.ok(columnRule, `expected a .${columnClass} rule`);
    assert.match(columnRule[0], /flex:\s*1/);
    assert.match(columnRule[0], /min-width:\s*0/);

    const labelRule = /\.copy-field-label\s*\{[^}]*\}/.exec(css);
    assert.ok(labelRule);
    assert.match(labelRule[0], /font-size:\s*var\(--text-xs\)/);
    assert.match(labelRule[0], /letter-spacing:/);
    assert.match(labelRule[0], /text-transform:\s*uppercase/);

    const valueRule = /\.copy-field-value\s*\{[^}]*\}/.exec(css);
    assert.ok(valueRule);
    assert.match(valueRule[0], /font-family:\s*ui-monospace/);
    assert.match(valueRule[0], /overflow:\s*hidden/);
    assert.match(valueRule[0], /text-overflow:\s*ellipsis/);
    assert.doesNotMatch(
      valueRule[0],
      /word-break/,
      "the component truncates, it does not wrap",
    );

    const buttonRule = /\.copy-field-button\s*\{[^}]*\}/.exec(css);
    assert.ok(buttonRule);
    assert.match(buttonRule[0], /font-weight:\s*var\(--weight-semibold\)/);
    assert.match(buttonRule[0], /min-width:\s*112px/);

    const containerRule = /\.copy-field\s*\{[^}]*\}/.exec(css);
    assert.ok(containerRule);
    assert.match(containerRule[0], /gap:\s*12px 16px/);
    assert.match(containerRule[0], /flex-wrap:\s*wrap/);

    // The label stack is what keeps the two handles the same width and stops
    // either from resizing when its receipt appears: every label sits in the
    // same single grid cell, and the reserved ones are invisible. Without all
    // three of these rules the reserves would stack vertically instead of
    // holding the width.
    const stackRule = /\.copy-field-button-stack\s*\{[^}]*\}/.exec(css);
    assert.ok(stackRule);
    assert.match(stackRule[0], /display:\s*grid/);

    const stackChildRule =
      /\.copy-field-button-stack\s*>\s*\*\s*\{[^}]*\}/.exec(css);
    assert.ok(stackChildRule);
    assert.match(stackChildRule[0], /grid-area:\s*1\s*\/\s*1/);

    const reserveRule = /\.copy-field-button-reserve\s*\{[^}]*\}/.exec(css);
    assert.ok(reserveRule);
    assert.match(reserveRule[0], /visibility:\s*hidden/);
  } finally {
    await t2.close();
  }
});

test("the JSON variant returns 201 with a location", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "My Site" },
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
    assert.strictEqual(res.status, 201);
    const json = await res.json();
    assert.match(json.location, /^\/handouts\/[a-km-np-z2-9]{10}$/);
  } finally {
    await t2.close();
  }
});

test("413 by Content-Length, before the body is read", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const smallBody = Buffer.from("not actually this big");
    const res = await rawRequest(t2.baseUrl, {
      method: "POST",
      path: "/handouts",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(600 * 1024 * 1024),
      },
      body: smallBody,
    });
    assert.strictEqual(res.status, 413);
    const json = JSON.parse(res.body.toString());
    assert.strictEqual(json.error, t("error.tooLarge", { limit: "500 MB" }));
  } finally {
    await t2.close();
  }
});

test("413 by a truncated stream (multipart fileSize limit)", async () => {
  const t2 = await buildTestServer({ maxUploadBytes: 1000 });
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const bigContent = Buffer.alloc(5000, "a");
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "big.html",
        content: bigContent,
        contentType: "text/html",
      },
      { name: "title", value: "Big file" },
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
    assert.strictEqual(res.status, 413);
    const json = await res.json();
    assert.strictEqual(json.error, t("error.tooLarge", { limit: "1 KB" }));
  } finally {
    await t2.close();
  }
});

test("415 for a .docx", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "doc.docx",
        content: Buffer.from("not a docx really"),
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { name: "title", value: "A document" },
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
    assert.strictEqual(res.status, 415);
    const json = await res.json();
    assert.strictEqual(json.error, strings["error.unsupported"]);
  } finally {
    await t2.close();
  }
});

test("415 for a .zip whose bytes are not a zip", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "fake.zip",
        content: Buffer.from("this is not a zip file"),
        contentType: "application/zip",
      },
      { name: "title", value: "Fake zip" },
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
    assert.strictEqual(res.status, 415);
    assert.match(res.headers.get("content-type"), /application\/json/);
    const json = await res.json();
    assert.strictEqual(json.error, strings["error.unsupported"]);
  } finally {
    await t2.close();
  }
});

// The JSON refusal contract (step 14/15): this is exactly where the client
// cannot pre-check, since only the server sees the bytes. An HTML body
// answering a request that asked for JSON is the fault this pins — the
// client's own onload only renders a JSON body, so an HTML answer here
// would silently drop the refusal.
test("415 for a bad zip, asked as JSON, answers application/json with the error key — not HTML", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "fake.zip",
        content: Buffer.from("this is not a zip file"),
        contentType: "application/zip",
      },
      { name: "title", value: "Fake zip" },
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
    assert.strictEqual(res.status, 415);
    const responseContentType = res.headers.get("content-type");
    assert.match(responseContentType, /application\/json/);
    assert.doesNotMatch(responseContentType, /text\/html/);
    const json = await res.json();
    assert.strictEqual(json.error, strings["error.unsupported"]);
  } finally {
    await t2.close();
  }
});

test("415 for the same bad zip, asked without Accept: application/json, answers HTML with the same message", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "fake.zip",
        content: Buffer.from("this is not a zip file"),
        contentType: "application/zip",
      },
      { name: "title", value: "Fake zip" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    });
    assert.strictEqual(res.status, 415);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes(strings["error.unsupported"]));
  } finally {
    await t2.close();
  }
});

test("422 for an empty title", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "" },
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
    assert.strictEqual(res.status, 422);
    const json = await res.json();
    assert.strictEqual(json.error, strings["error.noTitle"]);
  } finally {
    await t2.close();
  }
});

test("422 for an empty title, asked without Accept: application/json, marks the title field itself", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    });
    assert.strictEqual(res.status, 422);
    const html = await res.text();
    assert.ok(html.includes(strings["error.noTitle"]));
    // The design system marks a field in error with a danger border on the
    // input itself, not only the message above the form.
    assert.match(
      html,
      /<input(?=[^>]*data-title-input)(?=[^>]*class="field-input-error")[^>]*>/,
    );
  } finally {
    await t2.close();
  }
});

// Per docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md (D9): a
// zip with no HTML file gets its own screen, not a 4xx — the refusal is
// carried by /handouts/rejected and its sentence, on both the JSON and the
// no-JS path.
test("a zip with no HTML file answers a location to /handouts/rejected, JSON path", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "entryless.zip",
        content: ENTRYLESS,
        contentType: "application/zip",
      },
      { name: "title", value: "Entryless" },
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
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    const json = await res.json();
    assert.strictEqual(json.location, "/handouts/rejected");
  } finally {
    await t2.close();
  }
});

test("a zip with no HTML file answers a 303 to /handouts/rejected, no-JS path, and the rejected screen carries the sentence", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "entryless.zip",
        content: ENTRYLESS,
        contentType: "application/zip",
      },
      { name: "title", value: "Entryless" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
      redirect: "manual",
    });
    assert.strictEqual(res.status, 303);
    assert.strictEqual(res.headers.get("location"), "/handouts/rejected");

    const rejectedRes = await fetch(`${t2.baseUrl}/handouts/rejected`, {
      headers: { cookie },
    });
    assert.strictEqual(rejectedRes.status, 200);
    const html = await rejectedRes.text();
    assert.ok(html.includes(strings["error.noHtml"]));
  } finally {
    await t2.close();
  }
});

test("422 for the traversal zip, and nothing is written outside the data directory", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "evil.zip",
        content: TRAVERSAL,
        contentType: "application/zip",
      },
      { name: "title", value: "Evil" },
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
    assert.strictEqual(res.status, 422);
    const json = await res.json();
    assert.strictEqual(json.error, strings["error.unsafeZip"]);

    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const escaped = path.join(t2.config.handoutDataDir, "..", "etc", "passwd");
    await assert.rejects(() => fsp.access(escaped));
  } finally {
    await t2.close();
  }
});

// The pairing that stops the file-cause and the title-cause from collapsing
// into one: a refusal about the file frames the drop area and leaves the
// title field alone; the refusal about the title frames the field and
// leaves the drop area alone. Never both, whichever one fires.
function dropAreaHasErrorClass(html) {
  return /<div\s+class="drop-area error"/.test(html);
}

function titleInputHasErrorClass(html) {
  return /<input(?=[^>]*data-title-input)(?=[^>]*class="field-input-error")[^>]*>/.test(
    html,
  );
}

// A zip with no HTML file no longer frames the drop area — it gets its own
// screen (docs/adr/0012), covered above. The .docx case still covers the
// drop-area framing this table exists for.
const FILE_RELATED_REFUSALS = [
  {
    name: "unsupported type (.docx)",
    fields: [
      {
        type: "file",
        name: "file",
        filename: "doc.docx",
        content: Buffer.from("not a docx"),
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { name: "title", value: "A document" },
    ],
    status: 415,
  },
];

for (const { name, fields, status } of FILE_RELATED_REFUSALS) {
  test(`a file-related refusal (${name}) frames the drop area, not the title field`, async () => {
    const t2 = await buildTestServer();
    try {
      const cookie = t2.signSession({ sub: "u1" });
      const { body, contentType } = buildMultipart(fields);
      const res = await fetch(`${t2.baseUrl}/handouts`, {
        method: "POST",
        headers: { cookie, "content-type": contentType },
        body,
      });
      assert.strictEqual(res.status, status);
      const html = await res.text();
      assert.ok(
        dropAreaHasErrorClass(html),
        `expected the drop area to carry the error class for ${name}`,
      );
      assert.ok(
        !titleInputHasErrorClass(html),
        `expected the title field to stay unframed for ${name}`,
      );
    } finally {
      await t2.close();
    }
  });
}

test("the missing-title refusal frames the title field, not the drop area", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "site.zip",
        content: TWO_FILE_SITE,
        contentType: "application/zip",
      },
      { name: "title", value: "" },
    ]);
    const res = await fetch(`${t2.baseUrl}/handouts`, {
      method: "POST",
      headers: { cookie, "content-type": contentType },
      body,
    });
    assert.strictEqual(res.status, 422);
    const html = await res.text();
    assert.ok(
      titleInputHasErrorClass(html),
      "expected the title field to carry the error class",
    );
    assert.ok(
      !dropAreaHasErrorClass(html),
      "expected the drop area to stay unframed for a title-only refusal",
    );
  } finally {
    await t2.close();
  }
});

test("a 413 by Content-Length also frames the drop area, not the title field", async () => {
  const t2 = await buildTestServer();
  try {
    const cookie = t2.signSession({ sub: "u1" });
    const res = await rawRequest(t2.baseUrl, {
      method: "POST",
      path: "/handouts",
      headers: {
        cookie,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(600 * 1024 * 1024),
      },
      body: Buffer.from("irrelevant"),
    });
    assert.strictEqual(res.status, 413);
    const html = res.body.toString();
    assert.ok(dropAreaHasErrorClass(html));
    assert.ok(!titleInputHasErrorClass(html));
  } finally {
    await t2.close();
  }
});
