import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installShutdownHandlers } from "../src/shutdown.js";

// Fakes that record what happened in order, so the test can say which step came
// before which. A handler that ends the pool before the server has closed, or
// leaves out pool.end(), is the shape that makes `docker stop` hang.
function build({ closeError } = {}) {
  const calls = [];
  const target = new EventEmitter();
  target.exit = (code) => calls.push(`exit ${code}`);
  const fastify = {
    close: async () => {
      calls.push("close");
      if (closeError) throw closeError;
    },
  };
  const pool = {
    end: async () => {
      calls.push("end");
    },
  };
  installShutdownHandlers({ fastify, pool, target });
  return { calls, target };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("SIGTERM closes the server, then the pool, then exits 0", async () => {
  const { calls, target } = build();
  target.emit("SIGTERM");
  await settle();
  assert.deepEqual(calls, ["close", "end", "exit 0"]);
});

test("a second signal while the first is in flight does not close twice", async () => {
  const { calls, target } = build();
  target.emit("SIGTERM");
  target.emit("SIGTERM");
  target.emit("SIGINT");
  await settle();
  assert.deepEqual(calls, ["close", "end", "exit 0"]);
});

test("a failing close still ends in exit 1", async () => {
  const errors = [];
  const original = console.error;
  console.error = (err) => errors.push(err);
  try {
    const { calls, target } = build({ closeError: new Error("boom") });
    target.emit("SIGTERM");
    await settle();
    assert.deepEqual(calls, ["close", "exit 1"]);
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});
