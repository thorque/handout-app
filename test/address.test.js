import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateAddress,
  claimAddress,
  ADDRESS_PATTERN,
  ADDRESS_ALPHABET,
} from "../src/address.js";

test("generateAddress produces well-formed, varied, full-alphabet labels", () => {
  const draws = [];
  for (let i = 0; i < 2000; i += 1) {
    draws.push(generateAddress());
  }

  for (const address of draws) {
    assert.strictEqual(address.length, 10);
    assert.match(address, ADDRESS_PATTERN);
    for (const forbidden of ["l", "o", "0", "1"]) {
      assert.ok(
        !address.includes(forbidden),
        `${address} must not contain ${forbidden}`,
      );
    }
  }

  const distinct = new Set(draws);
  assert.ok(
    distinct.size >= 1990,
    `expected at least 1990 distinct addresses, got ${distinct.size}`,
  );

  const seen = new Set(draws.join("").split(""));
  for (const char of ADDRESS_ALPHABET) {
    assert.ok(
      seen.has(char),
      `alphabet character ${char} never appeared across the draws`,
    );
  }
});

test("claimAddress retries once on a unique violation and returns the second address", async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("duplicate key");
        err.code = "23505";
        throw err;
      }
      return {};
    },
  };
  const value = await claimAddress(client, "some-handout-id");
  assert.strictEqual(calls, 2);
  assert.match(value, ADDRESS_PATTERN);
});

test("claimAddress throws after exactly five attempts when always colliding", async () => {
  let calls = 0;
  const client = {
    query: async () => {
      calls += 1;
      const err = new Error("duplicate key");
      err.code = "23505";
      throw err;
    },
  };
  await assert.rejects(() => claimAddress(client, "some-handout-id"));
  assert.strictEqual(calls, 5);
});
