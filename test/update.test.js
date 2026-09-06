import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildTestServer } from "./helpers/app.js";
import { buildMultipart } from "./helpers/multipart.js";
import { strings } from "../src/views/strings.js";
import {
  materialise,
  stageStateInto,
  writeStatePointer,
  pruneStates,
  resolveState,
  readMetaFrom,
  containerFor,
  paths,
} from "../src/storage.js";
import { resolveTarget } from "../src/content.js";
import {
  TWO_FILE_SITE,
  SECOND_STATE,
  AMBIGUOUS,
  AMBIGUOUS_KEEPING_A,
  AMBIGUOUS_WITHOUT_A,
  TRAVERSAL,
  ENTRYLESS,
} from "./helpers/zip.js";

const ADDRESS_HOST_SUFFIX = "handout.example.com";

function addressHost(address) {
  return `${address}.${ADDRESS_HOST_SUFFIX}`;
}

function request(
  baseUrl,
  { method = "GET", path: urlPath, host, headers = {}, body, agent } = {},
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

function urlencoded(fields) {
  return new URLSearchParams(fields).toString();
}

async function publish(
  t,
  {
    zip = TWO_FILE_SITE,
    filename = "site.zip",
    title = "My Site",
    protect = false,
    password,
  } = {},
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
      filename,
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

async function postState(
  t,
  cookie,
  address,
  { zip, filename = "site.zip", contentType = "application/zip" },
) {
  const { body, contentType: ct } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename,
      content: zip,
      contentType,
    },
  ]);
  const res = await fetch(`${t.baseUrl}/handouts/${address}/state`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": ct,
    },
    body,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

test("an update serves the new state at the same address and bumps the row's time", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, { zip: TWO_FILE_SITE });

    const before = await t.pool.query(
      "select updated_at from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    const beforeUpdatedAt = before.rows[0].updated_at;

    const { res, json } = await postState(t, cookie, address, {
      zip: SECOND_STATE,
    });
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.ok(
      new Date(json.updatedAt).getTime() > new Date(beforeUpdatedAt).getTime(),
    );

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.strictEqual(root.status, 200);
    assert.ok(root.body.toString("utf8").includes("Second state"));

    const asset = await request(t.baseUrl, {
      path: "/assets/app.css",
      host: addressHost(address),
    });
    assert.strictEqual(asset.status, 200);
    assert.ok(asset.body.toString("utf8").includes("color: blue"));

    const dashRes = await fetch(`${t.baseUrl}/`, { headers: { cookie } });
    const dashHtml = await dashRes.text();
    assert.ok(dashHtml.includes(`datetime="${json.updatedAt}"`));
  } finally {
    await t.close();
  }
});

test("a fetch during the swap sees one complete state, never a mixture", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: TWO_FILE_SITE });
    const host = addressHost(address);

    const before = await request(t.baseUrl, { path: "/", host });
    const beforeEtag = before.headers.etag;
    assert.ok(beforeEtag);

    const incomingPath = path.join(
      t.config.handoutDataDir,
      "incoming",
      "second.zip",
    );
    await fs.writeFile(incomingPath, SECOND_STATE);
    const materialised = await materialise({
      kind: "zip",
      sourcePath: incomingPath,
      filename: "second.zip",
      config: t.config,
    });

    await stageStateInto(t.config, address, materialised.token);
    const duringRoot = await request(t.baseUrl, { path: "/", host });
    assert.ok(duringRoot.body.toString("utf8").includes("Two file site"));
    const duringAsset = await request(t.baseUrl, {
      path: "/assets/app.css",
      host,
    });
    assert.ok(duringAsset.body.toString("utf8").includes("color: red"));
    assert.strictEqual(duringRoot.headers.etag, beforeEtag);

    await writeStatePointer(t.config, address, materialised.token);
    const afterSwitchRoot = await request(t.baseUrl, { path: "/", host });
    assert.ok(afterSwitchRoot.body.toString("utf8").includes("Second state"));
    const afterSwitchAsset = await request(t.baseUrl, {
      path: "/assets/app.css",
      host,
    });
    assert.ok(afterSwitchAsset.body.toString("utf8").includes("color: blue"));
    assert.notStrictEqual(afterSwitchRoot.headers.etag, beforeEtag);

    await pruneStates(t.config, address);
    const afterPruneRoot = await request(t.baseUrl, { path: "/", host });
    assert.ok(afterPruneRoot.body.toString("utf8").includes("Second state"));
    const afterPruneAsset = await request(t.baseUrl, {
      path: "/assets/app.css",
      host,
    });
    assert.ok(afterPruneAsset.body.toString("utf8").includes("color: blue"));

    const containerEntries = await fs.readdir(containerFor(t.config, address));
    assert.strictEqual(containerEntries.length, 2);
    assert.ok(containerEntries.includes(".handout-state"));
    assert.ok(containerEntries.includes(materialised.token));
  } finally {
    await t.close();
  }
});

test("a request that pinned a state which is then swapped and removed under it gets the new state whole", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: TWO_FILE_SITE });

    const pinned = await resolveState(t.config, address);
    const pinnedMeta = await readMetaFrom(pinned.dir);

    const incomingPath = path.join(
      t.config.handoutDataDir,
      "incoming",
      "second.zip",
    );
    await fs.writeFile(incomingPath, SECOND_STATE);
    const materialised = await materialise({
      kind: "zip",
      sourcePath: incomingPath,
      filename: "second.zip",
      config: t.config,
    });
    await stageStateInto(t.config, address, materialised.token);
    await writeStatePointer(t.config, address, materialised.token);
    await pruneStates(t.config, address);

    const target = await resolveTarget(
      t.config,
      address,
      "/",
      pinned,
      pinnedMeta,
    );
    assert.ok(target, "expected the retry to resolve the new state");
    assert.strictEqual(target.stateId, materialised.token);
    const bytes = await fs.readFile(target.filePath, "utf8");
    assert.ok(bytes.includes("Second state"));
  } finally {
    await t.close();
  }
});

test("the same client gets the new content after the swap, not its cache", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, { zip: TWO_FILE_SITE });
    const host = addressHost(address);
    const agent = new http.Agent({ keepAlive: true });

    try {
      const first = await request(t.baseUrl, { path: "/", host, agent });
      assert.strictEqual(first.status, 200);
      const etag = first.headers.etag;
      assert.ok(etag);
      assert.ok(first.body.toString("utf8").includes("Two file site"));

      const cached = await request(t.baseUrl, {
        path: "/",
        host,
        agent,
        headers: { "if-none-match": etag },
      });
      assert.strictEqual(cached.status, 304);
      assert.strictEqual(cached.body.length, 0);

      await postState(t, cookie, address, { zip: SECOND_STATE });

      const revalidated = await request(t.baseUrl, {
        path: "/",
        host,
        agent,
        headers: { "if-none-match": etag },
      });
      assert.strictEqual(revalidated.status, 200);
      assert.ok(revalidated.body.toString("utf8").includes("Second state"));
      assert.notStrictEqual(revalidated.headers.etag, etag);
    } finally {
      agent.destroy();
    }
  } finally {
    await t.close();
  }
});

test("a protected handout keeps its password and its address across an update", async () => {
  const t = await buildTestServer();
  try {
    const password = "correct-horse-482";
    const { address, cookie } = await publish(t, {
      zip: TWO_FILE_SITE,
      protect: true,
      password,
    });
    const host = addressHost(address);

    const unlockRes = await request(t.baseUrl, {
      method: "POST",
      path: "/.handout/password",
      host,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(urlencoded({ password })),
      },
      body: urlencoded({ password }),
    });
    assert.strictEqual(unlockRes.status, 303);
    const unlockCookie = cookieHeaderFrom(setCookies(unlockRes));

    const { res: updateRes } = await postState(t, cookie, address, {
      zip: SECOND_STATE,
    });
    assert.strictEqual(updateRes.status, 200);

    const viewRes = await request(t.baseUrl, {
      path: "/",
      host,
      headers: { cookie: unlockCookie },
    });
    assert.strictEqual(viewRes.status, 200);
    assert.ok(viewRes.body.toString("utf8").includes("Second state"));

    const dbRow = await t.pool.query(
      "select h.password as password from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    assert.strictEqual(dbRow.rows[0].password, password);

    const addressRows = await t.pool.query(
      "select value from address where handout_id = (select id from handout where owner = $1)",
      ["u1"],
    );
    assert.strictEqual(addressRows.rows.length, 1);
    assert.strictEqual(addressRows.rows[0].value, address);
  } finally {
    await t.close();
  }
});

test("an upload that breaks off leaves the previous state complete", async () => {
  const t = await buildTestServer({ maxUploadBytes: 1000 });
  try {
    const { address, cookie } = await publish(t, { zip: TWO_FILE_SITE });

    const bigContent = Buffer.alloc(5000, "a");
    const { body, contentType } = buildMultipart([
      {
        type: "file",
        name: "file",
        filename: "big.html",
        content: bigContent,
        contentType: "text/html",
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
    assert.strictEqual(res.status, 413);

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(root.body.toString("utf8").includes("Two file site"));
    const asset = await request(t.baseUrl, {
      path: "/assets/app.css",
      host: addressHost(address),
    });
    assert.ok(asset.body.toString("utf8").includes("color: red"));

    const dirs = paths(t.config);
    assert.deepStrictEqual(await fs.readdir(dirs.staging), []);
    assert.deepStrictEqual(await fs.readdir(dirs.incoming), []);
  } finally {
    await t.close();
  }
});

test("the refusals a row upload can meet", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publish(t, { zip: TWO_FILE_SITE });

    const cases = [
      {
        name: "unsupported type (.docx)",
        filename: "doc.docx",
        content: Buffer.from("not a docx really"),
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        status: 415,
        error: strings["error.unsupported"],
      },
      {
        name: "a .zip whose bytes are not a zip",
        filename: "fake.zip",
        content: Buffer.from("this is not a zip file"),
        contentType: "application/zip",
        status: 415,
        error: strings["error.unsupported"],
      },
      {
        name: "the traversal zip",
        filename: "traversal.zip",
        content: TRAVERSAL,
        contentType: "application/zip",
        status: 422,
        error: strings["error.unsafeZip"],
      },
    ];

    for (const testCase of cases) {
      const { body, contentType } = buildMultipart([
        {
          type: "file",
          name: "file",
          filename: testCase.filename,
          content: testCase.content,
          contentType: testCase.contentType,
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
      assert.strictEqual(res.status, testCase.status, testCase.name);
      assert.match(res.headers.get("content-type"), /application\/json/);
      const json = await res.json();
      assert.strictEqual(json.error, testCase.error, testCase.name);

      const root = await request(t.baseUrl, {
        path: "/",
        host: addressHost(address),
      });
      assert.ok(
        root.body.toString("utf8").includes("Two file site"),
        `expected the old state to survive ${testCase.name}`,
      );
    }

    const { body: entrylessBody, contentType: entrylessContentType } =
      buildMultipart([
        {
          type: "file",
          name: "file",
          filename: "entryless.zip",
          content: ENTRYLESS,
          contentType: "application/zip",
        },
      ]);
    const entrylessRes = await fetch(`${t.baseUrl}/handouts/${address}/state`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": entrylessContentType,
      },
      body: entrylessBody,
    });
    assert.strictEqual(entrylessRes.status, 200);
    assert.match(entrylessRes.headers.get("content-type"), /application\/json/);
    const entrylessJson = await entrylessRes.json();
    assert.strictEqual(entrylessJson.location, "/handouts/rejected");

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(root.body.toString("utf8").includes("Two file site"));
  } finally {
    await t.close();
  }
});

test("a stranger cannot upload a new state, and neither can an unknown address", async () => {
  const t = await buildTestServer();
  try {
    const { address } = await publish(t, { zip: TWO_FILE_SITE });
    const strangerCookie = t.signSession({ sub: "u2" });

    const { res: strangerRes, json: strangerJson } = await postState(
      t,
      strangerCookie,
      address,
      { zip: SECOND_STATE },
    );
    assert.strictEqual(strangerRes.status, 404);
    assert.strictEqual(strangerJson.error, strings["error.unknownAddress"]);

    const ownerCookie = t.signSession({ sub: "u1" });
    const { res: unknownRes, json: unknownJson } = await postState(
      t,
      ownerCookie,
      "abc2defgh3",
      { zip: SECOND_STATE },
    );
    assert.strictEqual(unknownRes.status, 404);
    assert.strictEqual(unknownJson.error, strings["error.unknownAddress"]);

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(root.body.toString("utf8").includes("Two file site"));
  } finally {
    await t.close();
  }
});

async function publishAmbiguousChoosingA(t) {
  const cookie = t.signSession({
    sub: "u1",
    name: "Test User",
    email: "t@example.invalid",
  });
  const { body, contentType } = buildMultipart([
    {
      type: "file",
      name: "file",
      filename: "site.zip",
      content: AMBIGUOUS,
      contentType: "application/zip",
    },
    { name: "title", value: "Ambiguous Site" },
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

  const chooseRes = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
    method: "POST",
    headers: {
      cookie,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: urlencoded({ entry: "a.html" }),
  });
  const chooseJson = await chooseRes.json();
  assert.strictEqual(chooseRes.status, 201, JSON.stringify(chooseJson));
  return { address: chooseJson.location.split("/").pop(), cookie };
}

test("an ambiguous new state keeps the previous entry page", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publishAmbiguousChoosingA(t);

    const { res, json } = await postState(t, cookie, address, {
      zip: AMBIGUOUS_KEEPING_A,
    });
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.ok(json.updatedAt);
    assert.strictEqual(json.location, undefined);

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(root.body.toString("utf8").includes("a, updated"));
  } finally {
    await t.close();
  }
});

test("an ambiguous new state whose previous entry is gone asks, and the old state stays until the choice is made", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publishAmbiguousChoosingA(t);

    const { res, json } = await postState(t, cookie, address, {
      zip: AMBIGUOUS_WITHOUT_A,
    });
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.ok(json.location.startsWith("/handouts/entry/"));
    const token = json.location.split("/").pop();

    const stillOld = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(stillOld.body.toString("utf8").includes(">a<"));

    const choiceRes = await fetch(`${t.baseUrl}${json.location}`, {
      headers: { cookie },
    });
    const choiceHtml = await choiceRes.text();
    assert.ok(choiceHtml.includes("b.html"));
    assert.ok(choiceHtml.includes("c.html"));

    const confirmRes = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: urlencoded({ entry: "b.html" }),
    });
    const confirmJson = await confirmRes.json();
    assert.strictEqual(confirmRes.status, 200, JSON.stringify(confirmJson));
    assert.strictEqual(confirmJson.location, "/");

    const updated = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(updated.body.toString("utf8").includes("b, updated"));

    const secondConfirmRes = await fetch(
      `${t.baseUrl}/handouts/entry/${token}`,
      {
        method: "POST",
        headers: {
          cookie,
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: urlencoded({ entry: "b.html" }),
      },
    );
    assert.strictEqual(secondConfirmRes.status, 404);
    const secondConfirmHtml = await secondConfirmRes.text();
    assert.ok(secondConfirmHtml.includes(strings["error.uploadGone"]));
  } finally {
    await t.close();
  }
});

test("cancelling the choice on an update leaves the handout exactly as it was", async () => {
  const t = await buildTestServer();
  try {
    const { address, cookie } = await publishAmbiguousChoosingA(t);

    const before = await t.pool.query(
      "select updated_at from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    const beforeUpdatedAt = before.rows[0].updated_at.toISOString();

    const { json } = await postState(t, cookie, address, {
      zip: AMBIGUOUS_WITHOUT_A,
    });
    const token = json.location.split("/").pop();

    const cancelRes = await fetch(`${t.baseUrl}/handouts/entry/${token}`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: urlencoded({ cancel: "on" }),
    });
    const cancelJson = await cancelRes.json();
    assert.strictEqual(cancelRes.status, 200, JSON.stringify(cancelJson));
    assert.strictEqual(cancelJson.location, "/");

    const root = await request(t.baseUrl, {
      path: "/",
      host: addressHost(address),
    });
    assert.ok(root.body.toString("utf8").includes(">a<"));

    const dirs = paths(t.config);
    assert.deepStrictEqual(await fs.readdir(dirs.staging), []);
    const pendingFiles = await fs.readdir(dirs.pending);
    assert.deepStrictEqual(pendingFiles, []);

    const after = await t.pool.query(
      "select updated_at from handout h join address a on a.handout_id = h.id where a.value = $1",
      [address],
    );
    assert.strictEqual(after.rows[0].updated_at.toISOString(), beforeUpdatedAt);
  } finally {
    await t.close();
  }
});
