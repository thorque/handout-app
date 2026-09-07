import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveState, readMetaFrom } from "./storage.js";
import { contentTypeFor } from "./mime.js";
import { renderPasswordPage } from "./views/password.js";
import { renderNoHandoutPage } from "./views/no-handout.js";
import { loadProtection, isUnlocked, writeNext } from "./protection.js";

async function isDirectory(candidate) {
  try {
    const stat = await fsp.stat(candidate);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// The one viewer-side answer for an address that shows nothing (docs/adr/0023):
// a made-up label, an address whose handout was deleted, and a path that is not
// in a live handout all get this. One function on purpose — same status, same
// bytes, same headers, so the three cases cannot be told apart. `no-store`
// because a never-issued address can be issued later and its 404 must not
// outlive that; the other two get it because they have to look identical.
function noHandoutPage(reply, config) {
  return reply
    .code(404)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .send(renderNoHandoutPage({ config }));
}

function isNavigation(request) {
  return (request.headers.accept || "").includes("text/html");
}

// The strong validator for one file of one state — see
// docs/adr/0019-a-strong-etag-per-state.md. `relative` is the path inside
// the state's root actually served, after the entry and directory-index
// resolution have run, so a change to which file `/` resolves to changes
// this on its own.
export function etagFor(stateId, relative) {
  const hash = createHash("sha256").update(relative).digest("hex").slice(0, 16);
  return `"${stateId}-${hash}"`;
}

function matchesEtag(header, etag) {
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value.replace(/^W\//, "") === etag);
}

// Resolves the request's target inside one given state — the reserved-
// basename check, path resolution against the state's root, the containment
// check, the directory → index.html step, the stat — and returns
// { stateId, filePath, relative, stat, meta } or null.
async function resolveInState(state, meta, url) {
  const rootDir = path.resolve(state.dir, meta.root || "");

  const rawPath = url.split("?")[0];
  const decoded = decodeURIComponent(rawPath);
  const relative = decoded === "/" ? meta.entry : decoded.replace(/^\//, "");

  // ADR 0003's exact ".handout" and ADR 0018's exact ".handout-state" widen
  // to the whole ".handout" prefix here (docs/adr/0021): a live state's
  // .handout is rewritten in place through a `.handout.<random>` sibling
  // (setStateEntry), and that sibling sits inside the very directory served
  // as root when `root` is `""` — it must never be reachable while it lives.
  const base = path.basename(relative);
  if (base.startsWith(".handout")) {
    return null;
  }

  let targetPath = path.resolve(rootDir, relative);
  if (targetPath !== rootDir && !targetPath.startsWith(rootDir + path.sep)) {
    return null;
  }

  if (await isDirectory(targetPath)) {
    targetPath = path.join(targetPath, "index.html");
  }

  let stat;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }

  return { stateId: state.id, filePath: targetPath, relative, stat, meta };
}

// Resolves the request's target, pinned to `state`, with exactly one retry:
// when the file is not there, the pointer is read again, and only when it
// now names a *different* state is the whole resolution repeated once
// against that state, re-reading its own .handout so root, entry and file
// all come from the same state (docs/adr/0018). A state that was removed
// underneath this request because a newer upload replaced it must not 404
// the viewer for a file that only vanished because something newer took its
// place; a state that genuinely lacks the requested file still 404s once
// the retry finds nothing either. Exported so this race can be driven
// deterministically from a test, one step at a time.
export async function resolveTarget(config, address, url, state, meta) {
  const direct = await resolveInState(state, meta, url);
  if (direct) return direct;

  const retryState = await resolveState(config, address);
  if (retryState.id === state.id) return null;

  const retryMeta = await readMetaFrom(retryState.dir);
  if (!retryMeta) return null;

  return resolveInState(retryState, retryMeta, url);
}

export async function serveContent(request, reply, address, pool, config) {
  // A deleted address needs no branch of its own (docs/adr/0023):
  // removeContent already took its container away, so this read comes back
  // empty and this is the same exit a never-issued address takes too.
  const state = await resolveState(config, address);
  const meta = await readMetaFrom(state.dir);
  if (!meta) {
    return noHandoutPage(reply, config);
  }

  const row = await loadProtection(pool, address);
  if (!row) {
    return noHandoutPage(reply, config);
  }

  const password = row.password || null;
  if (password && !isUnlocked(request, config, address, password)) {
    if (
      isNavigation(request) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      writeNext(reply, config, request.url);
    }
    return reply
      .code(401)
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(renderPasswordPage({ error: false, config }));
  }

  const target = await resolveTarget(config, address, request.url, state, meta);
  if (!target) {
    return noHandoutPage(reply, config);
  }

  const { stateId, filePath, relative, stat, meta: targetMeta } = target;
  const etag = etagFor(stateId, relative);
  const cacheControl = password ? "private, no-cache" : "no-cache";
  const ifNoneMatch = request.headers["if-none-match"];
  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    reply.header("cache-control", cacheControl);
    reply.header("etag", etag);
    return reply.code(304).send();
  }

  const contentType = contentTypeFor(filePath);
  reply.header("content-type", contentType);
  reply.header("content-length", String(stat.size));
  reply.header("cache-control", cacheControl);
  reply.header("etag", etag);
  if (contentType === "application/pdf") {
    reply.header(
      "content-disposition",
      `inline; filename="${targetMeta.filename.replace(/"/g, "")}"`,
    );
  }
  // Returned, not merely sent: an async handler that resolves before a
  // stream finishes otherwise races Fastify's own completion of the reply.
  return reply.send(fs.createReadStream(filePath));
}
