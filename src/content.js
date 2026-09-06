import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveState, readMetaFrom } from "./storage.js";
import { contentTypeFor } from "./mime.js";
import { renderError } from "./views/error.js";
import { renderPasswordPage } from "./views/password.js";
import { strings } from "./views/strings.js";
import {
  VIEWER_ASSET_PREFIX,
  loadProtection,
  isUnlocked,
  writeNext,
} from "./protection.js";

async function isDirectory(candidate) {
  try {
    const stat = await fsp.stat(candidate);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function unknownAddressPage(reply) {
  return reply
    .code(404)
    .header("content-type", "text/html; charset=utf-8")
    .send(
      renderError({
        message: strings["error.unknownAddress"],
        assetPrefix: VIEWER_ASSET_PREFIX,
      }),
    );
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

  const base = path.basename(relative);
  if (base === ".handout" || base === ".handout-state") {
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
  const state = await resolveState(config, address);
  const meta = await readMetaFrom(state.dir);
  if (!meta) {
    return unknownAddressPage(reply);
  }

  const row = await loadProtection(pool, address);
  if (!row) {
    return unknownAddressPage(reply);
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
    return unknownAddressPage(reply);
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
