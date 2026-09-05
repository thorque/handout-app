import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveZipEntry,
  entryCandidatesFrom,
  assertSafeMember,
  materialise,
  paths,
  NoHtmlError,
  UnsafeZipError,
} from "../src/storage.js";
import {
  TWO_FILE_SITE,
  TRAVERSAL,
  AMBIGUOUS,
  ENTRYLESS,
} from "./helpers/zip.js";

// One test per branch of the four-branch result
// (docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md), in the
// issue's own order.

test('resolveZipEntry: index.html at the root resolves, root ""', () => {
  assert.deepStrictEqual(resolveZipEntry(["index.html", "assets/app.css"]), {
    status: "resolved",
    root: "",
    entry: "index.html",
  });
});

test("resolveZipEntry: a single wrapper folder holding index.html resolves to it", () => {
  assert.deepStrictEqual(
    resolveZipEntry(["dist/index.html", "dist/assets/app.css"]),
    { status: "resolved", root: "dist", entry: "index.html" },
  );
  // Extra files at the root are ignored as long as they are not HTML.
  assert.deepStrictEqual(resolveZipEntry(["dist/index.html", "README.md"]), {
    status: "resolved",
    root: "dist",
    entry: "index.html",
  });
});

test("resolveZipEntry: exactly one HTML member in the whole archive resolves to it", () => {
  assert.deepStrictEqual(
    resolveZipEntry(["docs/Prototyp.html", "docs/img/a.png"]),
    { status: "resolved", root: "docs", entry: "Prototyp.html" },
  );
});

test("resolveZipEntry: two or more HTML members is ambiguous, not refused", () => {
  assert.deepStrictEqual(resolveZipEntry(["a.html", "b.html"]), {
    status: "ambiguous",
    root: "",
    candidates: ["a.html", "b.html"],
  });
  assert.deepStrictEqual(resolveZipEntry(["a/index.html", "b/index.html"]), {
    status: "ambiguous",
    root: "",
    candidates: ["a/index.html", "b/index.html"],
  });
});

test("resolveZipEntry: no HTML member at all is status none", () => {
  assert.deepStrictEqual(resolveZipEntry(["styles.css", "img/a.png"]), {
    status: "none",
  });
});

// The tightened rule 2 (docs/adr/0012): a multi-page export whose only
// *folder* happens to hold an index.html, while its real pages sit at the
// root, must not resolve silently to that folder — it has to stay
// ambiguous, with every real HTML member in the candidate list. Fails
// against the code as it stood before this story, which answered
// {root:"uploads",entry:"index.html"} and hid "a.dc.html" and "b.dc.html".
test("resolveZipEntry: a folder holding index.html is not the root when HTML members sit outside it", () => {
  assert.deepStrictEqual(
    resolveZipEntry([
      "a.dc.html",
      "b.dc.html",
      "support.js",
      "uploads/index.html",
      "uploads/pixel.png",
    ]),
    {
      status: "ambiguous",
      root: "",
      candidates: ["a.dc.html", "b.dc.html", "uploads/index.html"],
    },
  );
});

// The candidate order — root first, then folders alphabetically, files
// inside them alphabetically — reproduced exactly from the design system's
// own "many" list (Handout-Designsystem--relevant-sections.dc.html, bottom
// script block), shuffled on the way in. A plain .sort() does not reproduce
// this order.
test("entryCandidatesFrom: sorts exactly like the design system's own candidate order", () => {
  const designOrder = [
    "Handout Designsystem.dc.html",
    "Handout Prototyp.dc.html",
    "HandoutZeile.dc.html",
    "seite.html",
    "kapitel-01/seite.html",
    "kapitel-02/anhang.html",
    "kapitel-02/seite.html",
    "kapitel-03/abbildungen.html",
    "kapitel-03/seite.html",
    "kapitel-04/seite.html",
    "uploads/index.html",
  ];
  const shuffled = [
    "kapitel-03/seite.html",
    "uploads/index.html",
    "HandoutZeile.dc.html",
    "kapitel-01/seite.html",
    "seite.html",
    "kapitel-02/seite.html",
    "Handout Designsystem.dc.html",
    "kapitel-04/seite.html",
    "kapitel-02/anhang.html",
    "Handout Prototyp.dc.html",
    "kapitel-03/abbildungen.html",
  ];
  assert.deepStrictEqual(entryCandidatesFrom(shuffled, ""), designOrder);
});

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
    { status: "resolved", root: "MyDesign", entry: "index.html" },
  ],
  [
    "noise is the only reason this wouldn't already resolve as exactly one real HTML file",
    ["docs/Prototyp.html", "docs/img/a.png", "__MACOSX/docs/._Prototyp.html"],
    { status: "resolved", root: "docs", entry: "Prototyp.html" },
  ],
  [
    "a top-level .DS_Store does not become a phantom sibling of the wrapper folder",
    [".DS_Store", "MyFolder/index.html", "MyFolder/app.css"],
    { status: "resolved", root: "MyFolder", entry: "index.html" },
  ],
];

for (const [description, members, expected] of noiseCases) {
  test(`resolveZipEntry ignores archive noise: ${description}`, () => {
    assert.deepStrictEqual(resolveZipEntry(members), expected);
  });
}

// The wrapper folder still wins as `root` in the ambiguous branch — the
// choice only ever sets `entry`, never `root` — with noise removed from the
// candidate list the same way. The existing noise test, inverted: this zip
// has no index.html, so it is ambiguous rather than refused.
test("resolveZipEntry: the wrapper folder still wins as root when the zip is ambiguous", () => {
  assert.deepStrictEqual(
    resolveZipEntry(["Site/a.html", "Site/b.html", "__MACOSX/Site/._a.html"]),
    { status: "ambiguous", root: "Site", candidates: ["a.html", "b.html"] },
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
// anything that can throw — an unsafe member, an entryless zip — so a throw
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

test("materialise leaves the staging root empty after an entryless zip (NoHtmlError), and the error is still the original", async () => {
  await withTempConfig(async (config) => {
    const sourcePath = await writeZipFixture(config, ENTRYLESS);
    await assert.rejects(
      () =>
        materialise({
          kind: "zip",
          sourcePath,
          filename: "upload.zip",
          config,
        }),
      NoHtmlError,
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

test("materialise keeps the staging directory after an ambiguous zip, extracted, with entry: null", async () => {
  await withTempConfig(async (config) => {
    const sourcePath = await writeZipFixture(config, AMBIGUOUS);
    const result = await materialise({
      kind: "zip",
      sourcePath,
      filename: "upload.zip",
      config,
    });

    assert.strictEqual(result.root, "");
    assert.strictEqual(result.entry, null);
    assert.deepStrictEqual(await stagingEntries(config), [result.token]);

    const stagingDir = path.join(paths(config).staging, result.token);
    const files = await fs.readdir(stagingDir);
    assert.ok(files.includes(".handout"));
    assert.ok(files.includes("a.html"));
    assert.ok(files.includes("b.html"));

    const meta = JSON.parse(
      await fs.readFile(path.join(stagingDir, ".handout"), "utf8"),
    );
    assert.deepStrictEqual(meta, {
      root: "",
      entry: null,
      kind: "zip",
      filename: "upload.zip",
    });
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
