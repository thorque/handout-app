import fsp from "node:fs/promises";
import { requireUser } from "../session.js";
import { handoutUrl } from "../host.js";
import { claimAddress } from "../address.js";
import {
  acceptUpload,
  detectKind,
  materialise,
  promoteToContent,
  removeStaging,
  removeContent,
  TooLargeError,
  UnsupportedError,
  NoEntryError,
  UnsafeZipError,
} from "../storage.js";
import { renderNewHandout, formatBytes } from "../views/new-handout.js";
import { renderDone } from "../views/done.js";
import { renderError } from "../views/error.js";
import { strings, t } from "../views/strings.js";

async function readFirstBytes(filePath, length) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function acceptsJson(request) {
  return (request.headers.accept || "").includes("application/json");
}

// isTitleError distinguishes the one refusal that is about the title from
// every other refusal, which is about the file: that pairing is what keeps
// the drop area's error frame and the title field's error frame from ever
// firing for the same cause, or both firing at once.
function sendRefusal(reply, request, config, status, message, title, isTitleError = false) {
  if (acceptsJson(request)) {
    return reply.code(status).send({ error: message });
  }
  return reply
    .code(status)
    .header("content-type", "text/html; charset=utf-8")
    .send(
      renderNewHandout({
        user: request.user,
        config,
        title,
        fileError: isTitleError ? undefined : message,
        titleError: isTitleError ? message : undefined,
      }),
    );
}

export default async function publisherRoutes(fastify) {
  const { config, pool } = fastify;

  fastify.get("/", { preHandler: requireUser }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("content-type", "text/html; charset=utf-8");
    return renderNewHandout({ user: request.user, config });
  });

  fastify.post("/handouts", { preHandler: requireUser }, async (request, reply) => {
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > config.maxUploadBytes) {
      return sendRefusal(
        reply,
        request,
        config,
        413,
        t("error.tooLarge", { limit: formatBytes(config.maxUploadBytes) }),
      );
    }

    let uploaded = null;
    let title = "";

    try {
      const parts = request.parts({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
      for await (const part of parts) {
        if (part.type === "file") {
          uploaded = await acceptUpload({ filename: part.filename, stream: part.file, config });
          if (part.file.truncated) {
            await fsp.rm(uploaded.path, { force: true });
            return sendRefusal(
              reply,
              request,
              config,
              413,
              t("error.tooLarge", { limit: formatBytes(config.maxUploadBytes) }),
              title,
            );
          }
        } else if (part.fieldname === "title") {
          title = String(part.value || "");
        }
      }
    } catch (err) {
      if (err instanceof TooLargeError) {
        if (uploaded) await fsp.rm(uploaded.path, { force: true });
        return sendRefusal(
          reply,
          request,
          config,
          413,
          t("error.tooLarge", { limit: formatBytes(config.maxUploadBytes) }),
          title,
        );
      }
      throw err;
    }

    if (!uploaded) {
      return sendRefusal(reply, request, config, 415, strings["error.unsupported"], title);
    }

    let kind;
    try {
      const firstBytes = await readFirstBytes(uploaded.path, 8);
      kind = detectKind(uploaded.filename, firstBytes);
    } catch (err) {
      await fsp.rm(uploaded.path, { force: true });
      if (err instanceof UnsupportedError) {
        return sendRefusal(reply, request, config, 415, strings["error.unsupported"], title);
      }
      throw err;
    }

    if (!title.trim()) {
      await fsp.rm(uploaded.path, { force: true });
      return sendRefusal(reply, request, config, 422, strings["error.noTitle"], title, true);
    }

    let materialised;
    try {
      materialised = await materialise({
        kind,
        sourcePath: uploaded.path,
        filename: uploaded.filename,
        config,
      });
    } catch (err) {
      await fsp.rm(uploaded.path, { force: true });
      if (err instanceof NoEntryError) {
        return sendRefusal(reply, request, config, 422, strings["error.noEntry"], title);
      }
      if (err instanceof UnsafeZipError) {
        return sendRefusal(reply, request, config, 422, strings["error.unsafeZip"], title);
      }
      throw err;
    }
    await fsp.rm(uploaded.path, { force: true });

    // The invariant after this route returns, whatever happened: no handout
    // row without its address, no address without content, and nothing left
    // under staging/. That is why the rename happens *inside* the
    // transaction, before commit, rather than after: a commit that
    // succeeded before a later, failing rename (ENOSPC, or EXDEV when the
    // data directory crosses a filesystem boundary) would otherwise hand out
    // an address whose directory was never created, 404 forever. On any
    // failure here — the rename's or the commit's own — the row is rolled
    // back and both possible remnants are removed: the promoted directory
    // (present if the rename ran before a later commit failure) and the
    // staging directory (present if the rename itself never ran, or never
    // finished). One of the two is always a no-op, which is cheaper than
    // reasoning about which. A full disk is exactly the case this matters
    // for: it is the case that repeats, and it is the case leftovers hurt
    // most, so this is not an edge case to skip.
    const client = await pool.connect();
    let address;
    try {
      await client.query("begin");
      const result = await client.query(
        "insert into handout (title, owner) values ($1, $2) returning id",
        [title.trim(), request.user.sub],
      );
      address = await claimAddress(client, result.rows[0].id);
      await promoteToContent(config, materialised.token, address);
      await client.query("commit");
    } catch (err) {
      // The cleanup itself failing must never hide why the publish failed —
      // log it and keep unwinding with the original error.
      await client.query("rollback").catch((cleanupErr) => request.log.error(cleanupErr));
      if (address) {
        await removeContent(config, address).catch((cleanupErr) => request.log.error(cleanupErr));
      }
      await removeStaging(config, materialised.token).catch((cleanupErr) =>
        request.log.error(cleanupErr),
      );
      throw err;
    } finally {
      client.release();
    }

    const location = `/handouts/${address}`;
    if (acceptsJson(request)) {
      return reply.code(201).send({ location });
    }
    return reply.code(303).header("location", location).send();
  });

  fastify.get("/handouts/:address", { preHandler: requireUser }, async (request, reply) => {
    const { address } = request.params;
    const result = await pool.query(
      `select h.title as title, h.owner as owner
       from address a
       join handout h on h.id = a.handout_id
       where a.value = $1`,
      [address],
    );
    const row = result.rows[0];
    if (!row || row.owner !== request.user.sub) {
      return reply
        .code(404)
        .header("content-type", "text/html; charset=utf-8")
        .send(renderError({ message: strings["error.unknownAddress"] }));
    }

    reply.header("content-type", "text/html; charset=utf-8");
    return renderDone({
      user: request.user,
      config,
      title: row.title,
      address: handoutUrl(request, address),
    });
  });
}
