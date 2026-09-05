import { test } from "node:test";
import assert from "node:assert/strict";
import { WORDS, suggestPassword, passwordMatches } from "../src/password.js";
import { delayFor, createThrottle } from "../src/throttle.js";

test("WORDS is exactly 128 distinct 4-7 letter lowercase words", () => {
  assert.strictEqual(WORDS.length, 128);
  assert.strictEqual(new Set(WORDS).size, 128);
  for (const word of WORDS) {
    assert.match(word, /^[a-z]{4,7}$/);
  }
});

test("suggestPassword draws word-word-word-ddd, covers every word, mostly distinct", () => {
  const seen = new Set();
  const wordsSeen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const value = suggestPassword();
    assert.match(value, /^[a-z]{4,7}(-[a-z]{4,7}){2}-[0-9]{3}$/);
    seen.add(value);
    for (const word of value.split("-").slice(0, 3)) {
      wordsSeen.add(word);
    }
  }
  assert.ok(
    seen.size >= 1990,
    `expected at least 1990 distinct draws, got ${seen.size}`,
  );
  assert.strictEqual(
    wordsSeen.size,
    WORDS.length,
    "expected every word in WORDS to appear at least once across 2000 draws",
  );
});

test("passwordMatches compares two non-empty strings and rejects everything else", () => {
  assert.strictEqual(passwordMatches("a", "a"), true);
  assert.strictEqual(passwordMatches("a", "b"), false);
  assert.strictEqual(passwordMatches("", ""), false);
  assert.strictEqual(passwordMatches("a", null), false);
  assert.strictEqual(passwordMatches(undefined, "a"), false);
  assert.strictEqual(passwordMatches("a", "ab"), false);
});

test("delayFor follows the growing schedule and caps at 10s", () => {
  const table = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 1000],
    [4, 2000],
    [5, 4000],
    [6, 8000],
    [7, 10000],
    [20, 10000],
  ];
  for (const [failures, expected] of table) {
    assert.strictEqual(delayFor(failures), expected);
  }
});

test("penalise always calls sleep, recording the whole schedule, and clear resets it", async () => {
  const recorded = [];
  const throttle = createThrottle({
    sleep: async (ms) => {
      recorded.push(ms);
    },
  });

  for (let i = 0; i < 5; i += 1) {
    await throttle.penalise("k");
  }
  assert.deepStrictEqual(recorded, [0, 0, 1000, 2000, 4000]);

  throttle.clear("k");
  await throttle.penalise("k");
  assert.deepStrictEqual(recorded, [0, 0, 1000, 2000, 4000, 0]);
});

test("an idle entry is forgotten after 15 minutes, and the map stays under the eviction cap", async () => {
  let current = 0;
  const throttle = createThrottle({
    sleep: async () => {},
    now: () => current,
  });

  await throttle.penalise("stale");
  assert.strictEqual(throttle.size(), 1);

  current += 16 * 60 * 1000;
  await throttle.penalise("other");
  assert.strictEqual(throttle.size(), 1, "the stale entry should be gone");

  for (let i = 0; i < 10050; i += 1) {
    current += 1;
    await throttle.penalise(`key-${i}`);
    assert.ok(throttle.size() <= 10000);
  }
  assert.ok(throttle.size() <= 10000);
});
