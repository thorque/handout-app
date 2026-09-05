import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveZipEntry,
  assertSafeMember,
  materialise,
  paths,
  NoEntryError,
  UnsafeZipError,
} from "../src/storage.js";
import { TWO_FILE_SITE, TRAVERSAL, AMBIGUOUS } from "./helpers/zip.js";

const entryCases = [
  [["index.html", "assets/app.css"], { root: "", entry: "index.html" }],
  [
    ["dist/index.html", "dist/assets/app.css"],
    { root: "dist", entry: "index.html" },
  ],
  [["dist/index.html", "README.md"], { root: "dist", entry: "index.html" }],
  [
    ["docs/Prototyp.html", "docs/img/a.png"],
    { root: "docs", entry: "Prototyp.html" },
  ],
];

for (const [members, expected] of entryCases) {
  test(`resolveZipEntry(${JSON.stringify(members)})`, () => {
    assert.deepStrictEqual(resolveZipEntry(members), expected);
  });
}

const noEntryCases = [
  ["a/index.html", "b/index.html"],
  ["styles.css", "img/a.png"],
  ["a.html", "b.html"],
];

for (const members of noEntryCases) {
  test(`resolveZipEntry(${JSON.stringify(members)}) throws NoEntryError`, () => {
    assert.throws(() => resolveZipEntry(members), NoEntryError);
  });
}

// Archive bookkeeping macOS (and Windows) add to a zip, which must never
// count as artifact content when resolving the entry — the real defect this
// guards was two zip members Finder adds when it zips a folder: a parallel
// __MACOSX/ tree (which breaks the "exactly one top-level directory" rule)
// whose AppleDouble twins end in .html too (which breaks the "exactly one
// html member" rule the same upload then falls through to).
const noiseCases = [
  [
    "the real shape Finder produces: a wrapper folder plus a full __MACOSX/ tree with AppleDouble twins",
    [
      "MyDesign/index.html",
      "MyDesign/about.html",
      "MyDesign/contact.html",
      "MyDesign/assets/app.css",
      "__MACOSX/MyDesign/._index.html",
      "__MACOSX/MyDesign/._about.html",
      "__MACOSX/MyDesign/._contact.html",
    ],
    { root: "MyDesign", entry: "index.html" },
  ],
  [
    "noise is the only reason this wouldn't already resolve as exactly one real HTML file",
    ["docs/Prototyp.html", "docs/img/a.png", "__MACOSX/docs/._Prototyp.html"],
    { root: "docs", entry: "Prototyp.html" },
  ],
  [
    "a top-level .DS_Store does not become a phantom sibling of the wrapper folder",
    [".DS_Store", "MyFolder/index.html", "MyFolder/app.css"],
    { root: "MyFolder", entry: "index.html" },
  ],
];

for (const [description, members, expected] of noiseCases) {
  test(`resolveZipEntry ignores archive noise: ${description}`, () => {
    assert.deepStrictEqual(resolveZipEntry(members), expected);
  });
}

test("resolveZipEntry still refuses a genuinely ambiguous zip (several real HTML files, no index.html) even with noise removed", () => {
  // Offering a list of candidates to the publisher is a later story; this one
  // does not start guessing among them.
  assert.throws(
    () =>
      resolveZipEntry(["Site/a.html", "Site/b.html", "__MACOSX/Site/._a.html"]),
    NoEntryError,
  );
});

const unsafeCases = ["../etc/passwd", "/etc/passwd", "dist/../../x"];

for (const member of unsafeCases) {
  test(`assertSafeMember(${JSON.stringify(member)}) throws UnsafeZipError`, () => {
    assert.throws(() => assertSafeMember(member), UnsafeZipError);
  });
}

test("assertSafeMember accepts ordinary relative paths", () => {
  assert.doesNotThrow(() => assertSafeMember("dist/index.html"));
  assert.doesNotThrow(() => assertSafeMember("index.html"));
});

// materialise either returns a staging directory or leaves nothing behind.
// staging/<token> is its own directory, created as its first act, before
// anything that can throw — an unsafe member, an ambiguous zip — so a throw
// from either of those must not leave that empty directory on disk with no
// token ever handed back to remove it by.
async function withTempConfig(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "handout-materialise-"));
  const config = { handoutDataDir: dir };
  try {
    await fn(config);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeZipFixture(config, buffer) {
  const sourcePath = path.join(config.handoutDataDir, "upload.zip");
  await fs.writeFile(sourcePath, buffer);
  return sourcePath;
}

async function stagingEntries(config) {
  const stagingRoot = paths(config).staging;
  try {
    return await fs.readdir(stagingRoot);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

test("materialise leaves the staging root empty after an ambiguous zip (NoEntryError), and the error is still the original", async () => {
  await withTempConfig(async (config) => {
    const sourcePath = await writeZipFixture(config, AMBIGUOUS);
    await assert.rejects(
      () =>
        materialise({
          kind: "zip",
          sourcePath,
          filename: "upload.zip",
          config,
        }),
      NoEntryError,
    );
    assert.deepStrictEqual(await stagingEntries(config), []);
  });
});

test("materialise leaves the staging root empty after an unsafe zip (UnsafeZipError), and the error is still the original", async () => {
  await withTempConfig(async (config) => {
    const sourcePath = await writeZipFixture(config, TRAVERSAL);
    await assert.rejects(
      () =>
        materialise({
          kind: "zip",
          sourcePath,
          filename: "upload.zip",
          config,
        }),
      UnsafeZipError,
    );
    assert.deepStrictEqual(await stagingEntries(config), []);
  });
});

test("materialise, the control case: a successful call keeps its staging directory with the extracted content plus .handout", async () => {
  await withTempConfig(async (config) => {
    const sourcePath = await writeZipFixture(config, TWO_FILE_SITE);
    const result = await materialise({
      kind: "zip",
      sourcePath,
      filename: "upload.zip",
      config,
    });

    assert.deepStrictEqual(await stagingEntries(config), [result.token]);
    const stagingDir = path.join(paths(config).staging, result.token);
    const files = await fs.readdir(stagingDir);
    assert.ok(files.includes(".handout"));
    assert.ok(files.includes("index.html"));
    assert.ok(files.includes("assets"));
  });
});
