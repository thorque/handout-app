import { crc32 } from "node:zlib";

// A minimal, store-mode zip writer — just enough structure for yauzl to read
// back the fixtures this test suite needs. No compression, no directory
// entries (extraction creates parent directories from file paths anyway).

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const data = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const checksum = crc32(data) >>> 0;

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSection.length),
    u32(localSection.length),
    u16(0),
  ]);

  return Buffer.concat([localSection, centralSection, end]);
}

export const TWO_FILE_SITE = buildZip([
  { name: "index.html", content: "<html><body>Two file site</body></html>" },
  { name: "assets/app.css", content: "body { color: red; }" },
]);

export const WRAPPER_SITE = buildZip([
  {
    name: "dist/index.html",
    content: "<html><body>Wrapper site</body></html>",
  },
  { name: "dist/assets/app.css", content: "body { color: blue; }" },
]);

export const ENTRYLESS = buildZip([
  { name: "styles.css", content: "body { color: green; }" },
]);

export const TRAVERSAL = buildZip([{ name: "../etc/passwd", content: "nope" }]);

// Now an *ambiguous* zip (docs/adr/0012), not a refused one: two HTML files,
// no index.html, no wrapper folder.
export const AMBIGUOUS = buildZip([
  { name: "a.html", content: "<html><body>a</body></html>" },
  { name: "b.html", content: "<html><body>b</body></html>" },
]);

// A second state for TWO_FILE_SITE's address: both files differ from it, so
// a mixture of the two is visible in either.
export const SECOND_STATE = buildZip([
  { name: "index.html", content: "<html><body>Second state</body></html>" },
  { name: "assets/app.css", content: "body { color: blue; }" },
]);

// An update onto a handout whose entry was chosen as a.html on AMBIGUOUS —
// still ambiguous, and a.html is still among its candidates (docs/adr/0020).
export const AMBIGUOUS_KEEPING_A = buildZip([
  { name: "a.html", content: "<html><body>a, updated</body></html>" },
  { name: "c.html", content: "<html><body>c</body></html>" },
]);

// The same situation, but the previous entry (a.html) is gone — the
// publisher has to be asked again (docs/adr/0020).
export const AMBIGUOUS_WITHOUT_A = buildZip([
  { name: "b.html", content: "<html><body>b, updated</body></html>" },
  { name: "c.html", content: "<html><body>c</body></html>" },
]);

// A real, minimal 1x1 PNG (not just bytes that merely look like one) — the
// static route's content-type check follows every reference out of a page,
// including an <img>, so the fixture has to decode.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// The shape a real export tool produces (neutral name on purpose —
// check:refs forbids naming a design tool in the tree): several HTML pages
// at the root, a shared script, and an uploads/ folder holding an
// index.html of its own — the exact case that used to resolve silently to
// `uploads/` and hide the real pages (docs/adr/0012). "page-two.html" is the
// one criterion 2 exercises: it references both a script and an image with
// relative paths.
export const MULTI_PAGE_EXPORT = buildZip([
  { name: "page-one.html", content: "<html><body>Page one</body></html>" },
  {
    name: "page-two.html",
    content:
      '<html><body>Page two<script src="support.js"></script><img src="uploads/pixel.png"></body></html>',
  },
  { name: "support.js", content: "console.log('support');" },
  {
    name: "uploads/index.html",
    content: "<html><body>Uploads index</body></html>",
  },
  { name: "uploads/pixel.png", content: PNG_BYTES },
]);

// Eleven root-level HTML members, all ambiguous — enough to cross the
// filter's >8 threshold (docs/adr/0012).
export const MANY_PAGES = buildZip(
  Array.from({ length: 11 }, (_, i) => ({
    name: `page-${String(i + 1).padStart(2, "0")}.html`,
    content: `<html><body>Page ${i + 1}</body></html>`,
  })),
);

// Carries every viewer case in one fixture: a sub page and an
// image (both must answer the password gate), plus two decoy paths whose
// names collide with the reserved prefix elsewhere in the app
// (handout.css, /static/*) to prove the reservation is exactly /.handout/
// and nothing wider.
export const PROTECTED_SITE = buildZip([
  { name: "index.html", content: "<html><body>Protected entry</body></html>" },
  { name: "sub/page.html", content: "<html><body>Sub page</body></html>" },
  { name: "assets/pixel.png", content: PNG_BYTES },
  { name: "handout.css", content: "body { color: teal; }" },
  { name: "static/app.css", content: "body { color: olive; }" },
]);
