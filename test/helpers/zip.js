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

export const AMBIGUOUS = buildZip([
  { name: "a.html", content: "<html><body>a</body></html>" },
  { name: "b.html", content: "<html><body>b</body></html>" },
]);
