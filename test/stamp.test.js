import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { utcStamp } from "../src/views/stamp.js";

test("utcStamp renders the day without a leading zero and the time with one", () => {
  assert.strictEqual(
    utcStamp(new Date("2026-09-02T19:44:00Z")),
    "2 September, 19:44",
  );
  assert.strictEqual(
    utcStamp(new Date("2026-08-28T09:12:00Z")),
    "28 August, 09:12",
  );
});

test("utcStamp gives the same answer regardless of the process's own time zone", () => {
  // Run in a spawned process with TZ=Asia/Tokyo: the test runner's own zone
  // is UTC in CI and would let a missing `timeZone: "UTC"` pass unnoticed.
  // In Tokyo, 2026-01-01T23:30:00Z is 2026-01-02 08:30 local, so an
  // implementation that forgets timeZone: "UTC" prints "2 January, 08:30"
  // here and this assertion fails.
  const moduleUrl = new URL("../src/views/stamp.js", import.meta.url).href;
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { utcStamp } from ${JSON.stringify(moduleUrl)};` +
        `process.stdout.write(utcStamp(new Date("2026-01-01T23:30:00Z")));`,
    ],
    { env: { ...process.env, TZ: "Asia/Tokyo" }, encoding: "utf8" },
  );
  assert.strictEqual(out, "1 January, 23:30");
});
