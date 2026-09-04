// Extension -> content type. No sniffing beyond the extension, and no
// X-Content-Type-Options: nosniff on artifact responses — the type is a guess
// from a file name, and forbidding the browser to correct it would break
// artifacts Handout guessed wrong about.

const TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function contentTypeFor(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  const ext = match ? match[1].toLowerCase() : "";
  return TYPES[ext] || "application/octet-stream";
}
