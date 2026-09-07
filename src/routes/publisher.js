import fsp from "node:fs/promises";
import path from "node:path";
import { requireUser } from "../session.js";
import { handoutUrl } from "../host.js";
import { claimAddress } from "../address.js";
import {
  acceptUpload,
  detectKind,
  materialise,
  installFirstState,
  readStatePointer,
  writeStatePointer,
  stageStateInto,
  resolveState,
  readMetaFrom,
  pruneStates,
  containerFor,
  removeStaging,
  removeContent,
  readPending,
  writePending,
  removePending,
  readStagingMeta,
  setStagingEntry,
  stagingEntryCandidates,
  hasSeveralEntryCandidates,
  stateEntryCandidates,
  setStateEntry,
  sweepAbandoned,
  TooLargeError,
  UnsupportedError,
  NoHtmlError,
  UnsafeZipError,
} from "../storage.js";
import { renderNewHandout, formatBytes } from "../views/new-handout.js";
import { renderDashboard } from "../views/dashboard.js";
import { renderDone } from "../views/done.js";
import { renderError } from "../views/error.js";
import { renderEntryChoice, renderRejected } from "../views/entry-choice.js";
import { strings, t } from "../views/strings.js";
import { utcStamp } from "../views/stamp.js";
import { PASSWORD_MAX_LENGTH, suggestPassword } from "../password.js";
import { messageText } from "../message.js";

// Thrown by swapState when the handout it was about to update was deleted
// while the upload was in flight (docs/adr/0022).
export class HandoutGoneError extends Error {}

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

// The transaction that turns a staged upload into a live address: insert the
// handout, claim an address, promote the staging directory, commit. See the
// long comment at its call site (below) for why the rename happens inside
// the transaction and what gets unwound on failure — extracted verbatim so
// both the direct publish and the entry-choice confirm route share exactly
// one path through it.
async function publishStaged({
  pool,
  config,
  request,
  title,
  protect,
  password,
  stagingToken,
}) {
  // A `null` entry reaching content/ would 500 on the first view — this is
  // the last point before the transaction where that is still cheap to
  // catch.
  const stagingMeta = await readStagingMeta(config, stagingToken);
  if (typeof stagingMeta.entry !== "string" || stagingMeta.entry === "") {
    throw new Error(
      "publishStaged called with no entry chosen for this staging directory",
    );
  }

  const client = await pool.connect();
  let address;
  try {
    await client.query("begin");
    // `owner` is the provider's identifier and the only thing that decides
    // who may see this row again. The email beside it decides nothing — it
    // is written so an operator moving to a different identity provider can
    // still tell whose handouts are whose, since every identifier changes in
    // that move (docs/adr/0017). An empty one is stored as null: a provider
    // is not obliged to hand an email over.
    const result = await client.query(
      "insert into handout (title, owner, owner_email, password) values ($1, $2, $3, $4) returning id",
      [
        title.trim(),
        request.user.sub,
        request.user.email || null,
        protect ? password : null,
      ],
    );
    address = await claimAddress(client, result.rows[0].id);
    // installFirstState creates the address's container, stages the
    // artifact into it as the one state it holds, then points at it — see
    // docs/adr/0018-a-handout-serves-one-state-behind-a-pointer.md.
    await installFirstState(config, stagingToken, address);
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
    await removeStaging(config, stagingToken).catch((cleanupErr) =>
      request.log.error(cleanupErr),
    );
    throw err;
  } finally {
    client.release();
  }

  return address;
}

// The transaction that replaces an already-published handout's live state
// with a newly staged one — the update route and the entry-choice confirm
// (once its address branch fires) both go through this and only this.
// See docs/adr/0018-a-handout-serves-one-state-behind-a-pointer.md.
// Exported so this race can be driven deterministically from a test, one
// step at a time.
export async function swapState({
  pool,
  config,
  request,
  handoutId,
  address,
  stagingToken,
}) {
  // The last cheap place to catch a missing entry, exactly as publishStaged
  // does for a first publish.
  const stagingMeta = await readStagingMeta(config, stagingToken);
  if (typeof stagingMeta.entry !== "string" || stagingMeta.entry === "") {
    throw new Error(
      "swapState called with no entry chosen for this staging directory",
    );
  }

  // May be null on a legacy container that has never had a pointer of its
  // own — the state directory the caller is about to replace is then the
  // container itself, and there is nothing to write the pointer back to on
  // failure, because there never was a pointer to begin with.
  const previous = await readStatePointer(config, address);

  const client = await pool.connect();
  let updatedAt;
  let staged = false;
  let pointerMoved = false;
  try {
    await client.query("begin");
    const result = await client.query(
      "update handout set updated_at = now() where id = $1 returning updated_at",
      [handoutId],
    );
    // Zero rows means the handout was deleted while this upload was in flight:
    // the DELETE holds the row lock, this UPDATE waits for it and then finds
    // nothing left. The delete wins (docs/adr/0022) — refuse here, before
    // anything is renamed into a container that is about to disappear, and let
    // the catch below roll back and remove the staging directory. Left alone,
    // rows[0] is undefined and this is a 500.
    if (result.rowCount === 0) {
      throw new HandoutGoneError("The handout was deleted while updating it");
    }
    updatedAt = result.rows[0].updated_at;
    // The filesystem work sits inside the transaction and before the commit
    // for the same reason publishStaged's does: a commit that succeeded
    // before a failing rename would leave the row claiming a state that was
    // never installed.
    await stageStateInto(config, address, stagingToken);
    staged = true;
    await writeStatePointer(config, address, stagingToken);
    pointerMoved = true;
    await client.query("commit");
  } catch (err) {
    // On any failure before the commit above returns: the pointer, if it
    // was already moved, is written back to what it named before this
    // attempt — a request holding it open then keeps seeing the state it
    // always saw, and a request that has only resolved the pointer since is
    // caught by resolveTarget's own single retry either way. `previous` can
    // be null (a legacy container never had a pointer); nothing is written
    // back then, and the legacy directory is still what resolveState falls
    // back to. Each cleanup is logged rather than allowed to replace the
    // original error, exactly as publishStaged's own unwind does.
    if (pointerMoved && previous) {
      await writeStatePointer(config, address, previous).catch((cleanupErr) =>
        request.log.error(cleanupErr),
      );
    }
    await client
      .query("rollback")
      .catch((cleanupErr) => request.log.error(cleanupErr));
    if (staged) {
      await fsp
        .rm(path.join(containerFor(config, address), stagingToken), {
          recursive: true,
          force: true,
        })
        .catch((cleanupErr) => request.log.error(cleanupErr));
    }
    await removeStaging(config, stagingToken).catch((cleanupErr) =>
      request.log.error(cleanupErr),
    );
    throw err;
  } finally {
    client.release();
  }

  // Removes the state that was just replaced (and, on a legacy container,
  // the old artifact's own files) — a failure here leaves disk behind and
  // nothing else, because the pointer alone decides what is served from
  // here on.
  await pruneStates(config, address).catch((err) => request.log.error(err));

  return updatedAt;
}

export default async function publisherRoutes(fastify) {
  const { config, pool } = fastify;

  fastify.get("/", { preHandler: requireUser }, async (request, reply) => {
    const result = await pool.query(
      `select h.title as title, h.password as password, h.updated_at as updated_at,
              a.value as address
         from handout h
         join address a on a.handout_id = h.id
        where h.owner = $1
        order by h.updated_at desc`,
      [request.user.sub],
    );

    // canChangeEntry asks a boolean per row rather than deriving the row's
    // candidate list (decision 1, docs/adr/0021): the dashboard is the
    // most-visited screen, and a row whose panel is never opened should not
    // pay for the full walk a fetched panel needs. A row whose disk read
    // fails (its content vanished underneath) answers `false` rather than
    // failing the whole dashboard — logged, not thrown.
    const handouts = await Promise.all(
      result.rows.map(async (row) => {
        const href = handoutUrl(request, row.address);
        const canChangeEntry = await hasSeveralEntryCandidates(
          config,
          row.address,
        ).catch((err) => {
          request.log.error(err);
          return false;
        });
        return {
          title: row.title,
          password: row.password,
          updatedAt: row.updated_at,
          href,
          address: href.replace(/^https?:\/\//, ""),
          // The bare address value, as it stands in the database and in the
          // update route's own URL (POST /handouts/:address/state) — distinct
          // from `address` above, which is the full host shown to the reader.
          rawAddress: row.address,
          canChangeEntry,
        };
      }),
    );

    reply.header("cache-control", "no-store");
    reply.header("content-type", "text/html; charset=utf-8");
    return renderDashboard({ user: request.user, config, handouts });
  });

  fastify.get(
    "/handouts/new",
    { preHandler: requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header("content-type", "text/html; charset=utf-8");
      return renderNewHandout({ user: request.user, config });
    },
  );

  fastify.post(
    "/handouts",
    { preHandler: requireUser },
    async (request, reply) => {
      // A failing sweep must never fail a publish — it only ever removes
      // what is already abandoned, so logging and carrying on is the whole
      // handling it needs.
      await sweepAbandoned(config).catch((err) => request.log.error(err));

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
        if (err instanceof NoHtmlError) {
          const location = "/handouts/rejected";
          if (acceptsJson(request)) {
            return reply.code(200).send({ location });
          }
          return reply.code(303).header("location", location).send();
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

      // The zip was ambiguous: materialise kept the staging directory with
      // entry: null. The pending record carries what publishStaged needs
      // once the entry is chosen — title, protect, password, owner and
      // filename — since the domain has no third entity to hold it in
      // (CLAUDE.md), so it lives on disk beside the staging directory. See
      // docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md.
      if (materialised.entry === null) {
        await writePending(config, materialised.token, {
          owner: request.user.sub,
          title: title.trim(),
          protect,
          password,
          filename: uploaded.filename,
          createdAt: new Date().toISOString(),
        });
        const location = `/handouts/entry/${materialised.token}`;
        if (acceptsJson(request)) {
          return reply.code(200).send({ location });
        }
        return reply.code(303).header("location", location).send();
      }

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
      const address = await publishStaged({
        pool,
        config,
        request,
        title,
        protect,
        password,
        stagingToken: materialised.token,
      });

      const location = `/handouts/${address}`;
      if (acceptsJson(request)) {
        return reply.code(201).send({ location });
      }
      return reply.code(303).header("location", location).send();
    },
  );

  // Uploads a new state onto an already-published handout, at the address
  // it already has. Answers JSON only, on every path — the `⋯` menu that
  // holds this action is rendered `hidden` and revealed by script
  // (initRowMenu(), src/public/handout.js), so there is no no-JavaScript
  // path into this route to serve a rendered HTML refusal to.
  fastify.post(
    "/handouts/:address/state",
    { preHandler: requireUser },
    async (request, reply) => {
      await sweepAbandoned(config).catch((err) => request.log.error(err));

      const { address } = request.params;
      const result = await pool.query(
        `select h.id as id, h.title as title, h.owner as owner, h.password as password
           from address a
           join handout h on h.id = a.handout_id
          where a.value = $1`,
        [address],
      );
      const row = result.rows[0];
      if (!row || row.owner !== request.user.sub) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      const contentLength = Number(request.headers["content-length"] || 0);
      if (contentLength > config.maxUploadBytes) {
        return reply.code(413).send({
          error: t("error.tooLarge", {
            limit: formatBytes(config.maxUploadBytes),
          }),
        });
      }

      let uploaded = null;
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
              return reply.code(413).send({
                error: t("error.tooLarge", {
                  limit: formatBytes(config.maxUploadBytes),
                }),
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof TooLargeError) {
          if (uploaded) await fsp.rm(uploaded.path, { force: true });
          return reply.code(413).send({
            error: t("error.tooLarge", {
              limit: formatBytes(config.maxUploadBytes),
            }),
          });
        }
        throw err;
      }

      if (!uploaded) {
        return reply.code(415).send({ error: strings["error.unsupported"] });
      }

      let kind;
      try {
        const firstBytes = await readFirstBytes(uploaded.path, 8);
        kind = detectKind(uploaded.filename, firstBytes);
      } catch (err) {
        await fsp.rm(uploaded.path, { force: true });
        if (err instanceof UnsupportedError) {
          return reply.code(415).send({ error: strings["error.unsupported"] });
        }
        throw err;
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
        if (err instanceof NoHtmlError) {
          return reply.code(200).send({ location: "/handouts/rejected" });
        }
        if (err instanceof UnsafeZipError) {
          return reply.code(422).send({ error: strings["error.unsafeZip"] });
        }
        throw err;
      }
      await fsp.rm(uploaded.path, { force: true });

      if (materialised.entry === null) {
        // Ambiguous — ADR 0020: the previous state's own entry is tried
        // first, silently, before asking anything. Only a previous entry
        // that is no longer among the new archive's candidates brings up
        // the existing entry-choice screen.
        const currentState = await resolveState(config, address);
        const currentMeta = await readMetaFrom(currentState.dir);
        const candidates = await stagingEntryCandidates(
          config,
          materialised.token,
        );
        if (currentMeta && candidates.includes(currentMeta.entry)) {
          await setStagingEntry(config, materialised.token, currentMeta.entry);
        } else {
          // The `address` key is what marks this pending record an update
          // rather than a first publish — the entry-choice confirm route
          // reads it to decide which of the two it is finishing.
          await writePending(config, materialised.token, {
            owner: request.user.sub,
            address,
            title: row.title,
            protect: !!row.password,
            password: row.password,
            filename: uploaded.filename,
            createdAt: new Date().toISOString(),
          });
          return reply
            .code(200)
            .send({ location: `/handouts/entry/${materialised.token}` });
        }
      }

      let updatedAt;
      try {
        updatedAt = await swapState({
          pool,
          config,
          request,
          handoutId: row.id,
          address,
          stagingToken: materialised.token,
        });
      } catch (err) {
        if (err instanceof HandoutGoneError) {
          // A conflict discovered mid-request, not an address that was
          // unknown when it began (docs/adr/0022) — the same code the
          // entry route already uses for error.entryStateMoved.
          return reply
            .code(409)
            .send({ error: strings["error.handoutDeleted"] });
        }
        throw err;
      }

      return reply.code(200).send({
        updatedAt: updatedAt.toISOString(),
        updatedAtText: t("stamp.utc", { stamp: utcStamp(updatedAt) }),
      });
    },
  );

  // Reads and rewrites which file a live state's `/` resolves to — no
  // upload, no database statement, only `entry` in the state's own
  // `.handout` (docs/adr/0021). JSON only, on every path, like the row
  // upload route above: the `⋯` menu that holds this action is rendered
  // hidden and revealed by script, so there is no no-JavaScript path into
  // either route to serve HTML into.
  fastify.get(
    "/handouts/:address/entry",
    { preHandler: requireUser },
    async (request, reply) => {
      const { address } = request.params;
      const result = await pool.query(
        "select h.owner as owner from address a join handout h on h.id = a.handout_id where a.value = $1",
        [address],
      );
      const row = result.rows[0];
      if (!row || row.owner !== request.user.sub) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      let found;
      try {
        found = await stateEntryCandidates(config, address);
      } catch (err) {
        if (err.code === "ENOENT") {
          return reply
            .code(404)
            .send({ error: strings["error.unknownAddress"] });
        }
        throw err;
      }
      if (!found) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      reply.header("cache-control", "no-store");
      return reply.send({
        entry: found.meta.entry ?? null,
        candidates: found.candidates,
      });
    },
  );

  fastify.post(
    "/handouts/:address/entry",
    { preHandler: requireUser },
    async (request, reply) => {
      const { address } = request.params;
      const result = await pool.query(
        "select h.owner as owner from address a join handout h on h.id = a.handout_id where a.value = $1",
        [address],
      );
      const row = result.rows[0];
      if (!row || row.owner !== request.user.sub) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      let found;
      try {
        found = await stateEntryCandidates(config, address);
      } catch (err) {
        if (err.code === "ENOENT") {
          return reply
            .code(404)
            .send({ error: strings["error.unknownAddress"] });
        }
        throw err;
      }
      if (!found) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      const entry =
        typeof request.body?.entry === "string" ? request.body.entry : "";
      if (!entry) {
        return reply.code(422).send({ error: strings["error.entryNotChosen"] });
      }
      // Exact membership, the same gate the entry-choice route already
      // uses: it is the only check that also refuses a real member of the
      // zip that is not HTML, not only a path outside the root.
      if (!found.candidates.includes(entry)) {
        return reply.code(422).send({ error: strings["error.entryNotInZip"] });
      }

      // The pointer may have moved between the resolution above and this
      // write (a concurrent upload landing a new state). Re-reading it now
      // and refusing on a mismatch is cheaper than re-checking after a
      // write that could otherwise land on the wrong state — and applying a
      // choice made against a list that no longer describes what is served
      // would be a guess, not a correction (docs/adr/0020, docs/adr/0021).
      const currentPointer = await readStatePointer(config, address);
      const stillCurrent = currentPointer
        ? currentPointer === found.state.id
        : found.state.id === address;
      if (!stillCurrent) {
        return reply
          .code(409)
          .send({ error: strings["error.entryStateMoved"] });
      }

      try {
        await setStateEntry(found.state.dir, entry);
      } catch (err) {
        if (err.code === "ENOENT") {
          return reply
            .code(409)
            .send({ error: strings["error.entryStateMoved"] });
        }
        throw err;
      }

      // No database statement on this path — `updated_at` names the last
      // uploaded state, and nothing was uploaded (the fourth acceptance
      // criterion).
      return reply.code(200).send({ entry });
    },
  );

  // Replaces a handout's password — issuing a new one, or setting one on a
  // handout that had none — without touching the address (docs/adr/0025).
  // JSON only, on every path, like the row's other two JSON routes above:
  // the ⋯ menu that holds this action is rendered hidden and revealed by
  // script, so there is no no-JavaScript path into this route to serve HTML
  // into.
  fastify.post(
    "/handouts/:address/password",
    { preHandler: requireUser },
    async (request, reply) => {
      const { address } = request.params;
      const result = await pool.query(
        "select h.id as id, h.owner as owner from address a join handout h on h.id = a.handout_id where a.value = $1",
        [address],
      );
      const row = result.rows[0];
      if (!row || row.owner !== request.user.sub) {
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      const typed =
        typeof request.body?.password === "string" ? request.body.password : "";
      // An empty field removes the password rather than being refused — the
      // prototype's own rotate panel takes this path too (rotateLabel and
      // isProtected are both derived from `pw`), and the design system's
      // "password is missing" refusal belongs to the publish screen's
      // checkbox, which this panel does not have (docs/adr/0025). `null`,
      // not "", is what an unprotected handout carries out of a first
      // publish — one column, one representation of "no password". The
      // stored value is otherwise kept untrimmed, exactly as `POST
      // /handouts` keeps it; `trim()` here only detects emptiness.
      const password = typed.trim() === "" ? null : typed;
      if (password && password.length > PASSWORD_MAX_LENGTH) {
        return reply.code(422).send({
          error: t("error.passwordTooLong", { limit: PASSWORD_MAX_LENGTH }),
        });
      }

      // `owner` is repeated here although it was just checked, so the
      // writing statement is true on its own (docs/adr/0022's own pattern).
      // No `updated_at` in this statement, and no database trigger sets it
      // (checked migrations/1700000000000_handout-and-address.cjs):
      // `updated_at` names "last state uploaded", and nothing was uploaded
      // (docs/adr/0025). Existing viewer sessions expire with no new
      // mechanism here — isUnlocked() compares the unlock cookie's
      // fingerprint against the password read from the row on every
      // request, so replacing it invalidates every open session by
      // construction (src/protection.js); removing the password takes the
      // gate itself out (src/content.js's `password &&` check), so a viewer
      // is not even asked any more.
      const update = await pool.query(
        "update handout set password = $1 where id = $2 and owner = $3",
        [password, row.id, request.user.sub],
      );
      if (update.rowCount === 0) {
        // The handout was deleted between the check above and this write.
        return reply.code(404).send({ error: strings["error.unknownAddress"] });
      }

      const href = handoutUrl(request, address);
      return reply
        .code(200)
        .send({ password, message: messageText(href, password) });
    },
  );

  // Deleting a handout. A form POST answered with 303, not a fetch: nothing
  // streams and nothing is swapped in place, so the count sentence and the
  // empty state come back from the server the way they always do. HTML on
  // every path, unlike the row's JSON routes — this one is a real form
  // navigation. Cross-site protection is the session cookie's sameSite=lax,
  // the same protection POST /handouts already has.
  fastify.post(
    "/handouts/:address/delete",
    { preHandler: requireUser },
    async (request, reply) => {
      const { address } = request.params;
      const result = await pool.query(
        "select h.id as id, h.owner as owner from address a join handout h on h.id = a.handout_id where a.value = $1",
        [address],
      );
      const row = result.rows[0];
      if (!row || row.owner !== request.user.sub) {
        return reply
          .code(404)
          .header("content-type", "text/html; charset=utf-8")
          .send(renderError({ message: strings["error.unknownAddress"] }));
      }

      // The row first, the bytes after (docs/adr/0022). `owner` is repeated in
      // the statement although it was just checked, so the destructive
      // statement is true on its own. The foreign key's `on delete set null`
      // leaves the address row standing with handout_id null — that is the
      // "taken, but empty" state, and it is what keeps claimAddress from ever
      // handing this value out again.
      await pool.query("delete from handout where id = $1 and owner = $2", [
        row.id,
        request.user.sub,
      ]);
      await removeContent(config, address).catch((err) =>
        request.log.error(err),
      );

      return reply.code(303).header("location", "/").send();
    },
  );

  fastify.get(
    "/handouts/rejected",
    { preHandler: requireUser },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header("content-type", "text/html; charset=utf-8");
      return renderRejected({ user: request.user, config });
    },
  );

  fastify.get(
    "/handouts/entry/:token",
    { preHandler: requireUser },
    async (request, reply) => {
      const { token: stagingToken } = request.params;
      const pending = await readPending(config, stagingToken);
      if (!pending || pending.owner !== request.user.sub) {
        return reply
          .code(404)
          .header("content-type", "text/html; charset=utf-8")
          .send(renderError({ message: strings["error.uploadGone"] }));
      }

      const candidates = await stagingEntryCandidates(config, stagingToken);
      reply.header("cache-control", "no-store");
      reply.header("content-type", "text/html; charset=utf-8");
      return renderEntryChoice({
        user: request.user,
        config,
        token: stagingToken,
        filename: pending.filename,
        title: pending.title,
        protect: pending.protect,
        candidates,
      });
    },
  );

  fastify.post(
    "/handouts/entry/:token",
    { preHandler: requireUser },
    async (request, reply) => {
      const { token: stagingToken } = request.params;
      const pending = await readPending(config, stagingToken);
      if (!pending || pending.owner !== request.user.sub) {
        return reply
          .code(404)
          .header("content-type", "text/html; charset=utf-8")
          .send(renderError({ message: strings["error.uploadGone"] }));
      }

      const body = request.body || {};
      if (body.cancel) {
        await removeStaging(config, stagingToken);
        await removePending(config, stagingToken);
        // Abandoning a flow in any phase goes back to the dashboard —
        // nothing was published, and there is nothing left to resume.
        const location = "/";
        if (acceptsJson(request)) {
          return reply.code(200).send({ location });
        }
        return reply.code(303).header("location", location).send();
      }

      const candidates = await stagingEntryCandidates(config, stagingToken);
      const entry = typeof body.entry === "string" ? body.entry : "";

      async function reRenderWithError(message) {
        reply.header("cache-control", "no-store");
        reply.header("content-type", "text/html; charset=utf-8");
        return reply.code(422).send(
          renderEntryChoice({
            user: request.user,
            config,
            token: stagingToken,
            filename: pending.filename,
            title: pending.title,
            protect: pending.protect,
            candidates,
            error: message,
          }),
        );
      }

      if (!entry) {
        return reRenderWithError(strings["error.entryNotChosen"]);
      }
      // Exact membership in this array is the gate: it is the only check
      // that also refuses a real member of the zip that is not HTML, not
      // only a path outside the root.
      if (!candidates.includes(entry)) {
        return reRenderWithError(strings["error.entryNotInZip"]);
      }

      await setStagingEntry(config, stagingToken, entry);

      // `pending.address` is what marks this record an update rather than a
      // first publish (see the update route, POST /handouts/:address/state).
      if (pending.address) {
        const result = await pool.query(
          "select h.id as id from address a join handout h on h.id = a.handout_id where a.value = $1 and h.owner = $2",
          [pending.address, request.user.sub],
        );
        const row = result.rows[0];
        if (!row) {
          return reply
            .code(404)
            .header("content-type", "text/html; charset=utf-8")
            .send(renderError({ message: strings["error.unknownAddress"] }));
        }

        let updatedAt;
        try {
          updatedAt = await swapState({
            pool,
            config,
            request,
            handoutId: row.id,
            address: pending.address,
            stagingToken,
          });
        } catch (err) {
          if (err instanceof HandoutGoneError) {
            // A conflict discovered mid-request (docs/adr/0022). Its
            // pending record is left for sweepAbandoned, exactly as every
            // other failure path on this route leaves it.
            if (acceptsJson(request)) {
              return reply
                .code(409)
                .send({ error: strings["error.handoutDeleted"] });
            }
            reply.header("content-type", "text/html; charset=utf-8");
            return reply
              .code(409)
              .send(renderError({ message: strings["error.handoutDeleted"] }));
          }
          throw err;
        }
        await removePending(config, stagingToken).catch((err) =>
          request.log.error(err),
        );

        // An update ends where the journey started — the dashboard, not the
        // first-publish result page, whose "the address is permanent"
        // sentence belongs to a first publish only.
        const location = "/";
        if (acceptsJson(request)) {
          return reply.code(200).send({
            location,
            updatedAt: updatedAt.toISOString(),
            updatedAtText: t("stamp.utc", { stamp: utcStamp(updatedAt) }),
          });
        }
        return reply.code(303).header("location", location).send();
      }

      const address = await publishStaged({
        pool,
        config,
        request,
        title: pending.title,
        protect: pending.protect,
        password: pending.password,
        stagingToken,
      });
      await removePending(config, stagingToken).catch((err) =>
        request.log.error(err),
      );

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
