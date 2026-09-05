import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readMeta, contentDirFor } from "./storage.js";
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

export async function serveContent(request, reply, address, pool, config) {
  const meta = await readMeta(config, address);
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

  const contentDir = contentDirFor(config, address);
  const rootDir = path.resolve(contentDir, meta.root || "");

  const rawPath = request.url.split("?")[0];
  const decoded = decodeURIComponent(rawPath);
  const relative = decoded === "/" ? meta.entry : decoded.replace(/^\//, "");

  if (path.basename(relative) === ".handout") {
    return unknownAddressPage(reply);
  }

  let targetPath = path.resolve(rootDir, relative);
  if (targetPath !== rootDir && !targetPath.startsWith(rootDir + path.sep)) {
    return unknownAddressPage(reply);
  }

  if (await isDirectory(targetPath)) {
    targetPath = path.join(targetPath, "index.html");
  }

  let stat;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    return unknownAddressPage(reply);
  }
  if (!stat.isFile()) {
    return unknownAddressPage(reply);
  }

  const contentType = contentTypeFor(targetPath);
  reply.header("content-type", contentType);
  reply.header("content-length", String(stat.size));
  reply.header("cache-control", password ? "private, no-cache" : "no-cache");
  if (contentType === "application/pdf") {
    reply.header(
      "content-disposition",
      `inline; filename="${meta.filename.replace(/"/g, "")}"`,
    );
  }
  // Returned, not merely sent: an async handler that resolves before a
  // stream finishes otherwise races Fastify's own completion of the reply.
  return reply.send(fs.createReadStream(targetPath));
}
