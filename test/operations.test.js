import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTestServer } from "./helpers/app.js";
import { TLS_CHECK_PATH, HEALTH_PATH } from "../src/routes/operations.js";

// The two routes Caddy and the compose healthcheck use. The ask route is what
// keeps a stranger from spending the weekly certificate quota, and what keeps
// an old link's certificate alive after its handout is gone (see
// docs/adr/0023-one-answer-for-an-address-that-shows-nothing.md).

const SUFFIX = "handout.example.com";
const LIVE = "abcdefghij";
const DELETED = "kmnpqrstuv";

async function setup(t) {
  const server = await buildTestServer();
  t.after(() => server.close());
  const inserted = await server.pool.query(
    "insert into handout (title, owner) values ($1, $2) returning id",
    ["Live", "u1"],
  );
  await server.pool.query(
    "insert into address (value, handout_id) values ($1, $2)",
    [LIVE, inserted.rows[0].id],
  );
  await server.pool.query(
    "insert into address (value, handout_id) values ($1, null)",
    [DELETED],
  );
  return server;
}

async function ask(server, domain) {
  const query = domain === undefined ? "" : `?domain=${domain}`;
  return fetch(`${server.baseUrl}${TLS_CHECK_PATH}${query}`);
}

test("a live address is allowed a certificate", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, `${LIVE}.${SUFFIX}`)).status, 204);
});

test("a deleted handout's address is still allowed a certificate", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, `${DELETED}.${SUFFIX}`)).status, 204);
});

test("a well-formed address that was never issued is refused", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, `zzzzzzzzzz.${SUFFIX}`)).status, 404);
});

test("the publisher origin is refused", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, SUFFIX)).status, 404);
});

test("the identity provider's name is refused", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, `id.${SUFFIX}`)).status, 404);
});

test("a label with characters outside the address alphabet is refused", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server, `1234567890.${SUFFIX}`)).status, 404);
});

test("no domain at all is refused", async (t) => {
  const server = await setup(t);
  assert.equal((await ask(server)).status, 404);
});

test("the health route answers 200 with JSON", async (t) => {
  const server = await setup(t);
  const response = await fetch(`${server.baseUrl}${HEALTH_PATH}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
