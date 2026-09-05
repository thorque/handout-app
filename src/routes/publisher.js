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
import { PASSWORD_MAX_LENGTH, suggestPassword } from "../password.js";

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

// `field` distinguishes which refusal frame lights up — "file", "title" or
// "password" — so the drop area's, the title field's and the password
// field's error frames never fire for the same cause, or more than one at
// once. `protect` and `password` are passed back through so a re-render
// keeps what the publisher typed.
function sendRefusal(
  reply,
  request,
  config,
  status,
  message,
  { title, protect, password, field = "file" } = {},
) {
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
        protect,
        password,
        fileError: field === "file" ? message : undefined,
        titleError: field === "title" ? message : undefined,
        passwordError: field === "password" ? message : undefined,
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

  fastify.post(
    "/handouts",
    { preHandler: requireUser },
    async (request, reply) => {
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
      let protect = false;
      let password = "";

      try {
        const parts = request.parts({
          limits: { fileSize: config.maxUploadBytes, files: 1 },
        });
        for await (const part of parts) {
          if (part.type === "file") {
            uploaded = await acceptUpload({
              filename: part.filename,
              stream: part.file,
              config,
            });
            if (part.file.truncated) {
              await fsp.rm(uploaded.path, { force: true });
              return sendRefusal(
                reply,
                request,
                config,
                413,
                t("error.tooLarge", {
                  limit: formatBytes(config.maxUploadBytes),
                }),
                { title, protect, password },
              );
            }
          } else if (part.fieldname === "title") {
            title = String(part.value || "");
          } else if (part.fieldname === "protect") {
            // An unchecked checkbox sends nothing at all, so *presence* of
            // this field is the signal — its value is never compared.
            protect = true;
          } else if (part.fieldname === "password") {
            password = String(part.value || "");
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
            { title, protect, password },
          );
        }
        throw err;
      }

      if (!uploaded) {
        return sendRefusal(
          reply,
          request,
          config,
          415,
          strings["error.unsupported"],
          { title, protect, password },
        );
      }

      let kind;
      try {
        const firstBytes = await readFirstBytes(uploaded.path, 8);
        kind = detectKind(uploaded.filename, firstBytes);
      } catch (err) {
        await fsp.rm(uploaded.path, { force: true });
        if (err instanceof UnsupportedError) {
          return sendRefusal(
            reply,
            request,
            config,
            415,
            strings["error.unsupported"],
            { title, protect, password },
          );
        }
        throw err;
      }

      if (!title.trim()) {
        await fsp.rm(uploaded.path, { force: true });
        return sendRefusal(
          reply,
          request,
          config,
          422,
          strings["error.noTitle"],
          {
            title,
            protect,
            password,
            field: "title",
          },
        );
      }

      // protect absent -> the password field is ignored entirely and the
      // handout is unprotected, which is what keeps every existing
      // publish test (sending neither field) publishing unprotected.
      if (protect && password.trim() === "") {
        await fsp.rm(uploaded.path, { force: true });
        return sendRefusal(
          reply,
          request,
          config,
          422,
          strings["error.passwordMissing"],
          { title, protect, password, field: "password" },
        );
      }
      if (protect && password.length > PASSWORD_MAX_LENGTH) {
        await fsp.rm(uploaded.path, { force: true });
        return sendRefusal(
          reply,
          request,
          config,
          422,
          t("error.passwordTooLong", { limit: PASSWORD_MAX_LENGTH }),
          { title, protect, password, field: "password" },
        );
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
          return sendRefusal(
            reply,
            request,
            config,
            422,
            strings["error.noEntry"],
            { title, protect, password },
          );
        }
        if (err instanceof UnsafeZipError) {
          return sendRefusal(
            reply,
            request,
            config,
            422,
            strings["error.unsafeZip"],
            { title, protect, password },
          );
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
          "insert into handout (title, owner, password) values ($1, $2, $3) returning id",
          [title.trim(), request.user.sub, protect ? password : null],
        );
        address = await claimAddress(client, result.rows[0].id);
        await promoteToContent(config, materialised.token, address);
        await client.query("commit");
      } catch (err) {
        // The cleanup itself failing must never hide why the publish failed —
        // log it and keep unwinding with the original error.
        await client
          .query("rollback")
          .catch((cleanupErr) => request.log.error(cleanupErr));
        if (address) {
          await removeContent(config, address).catch((cleanupErr) =>
            request.log.error(cleanupErr),
          );
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
    },
  );

  fastify.get(
    "/handouts/:address",
    { preHandler: requireUser },
    async (request, reply) => {
      const { address } = request.params;
      const result = await pool.query(
        `select h.title as title, h.owner as owner, h.password as password
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
      reply.header("cache-control", "no-store");
      return renderDone({
        user: request.user,
        config,
        title: row.title,
        address: handoutUrl(request, address),
        password: row.password,
      });
    },
  );

  fastify.get(
    "/password-suggestion",
    { preHandler: requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return reply.send({ password: suggestPassword() });
    },
  );
}
