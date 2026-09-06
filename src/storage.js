import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import yauzl from "yauzl";

export class TooLargeError extends Error {}
export class UnsupportedError extends Error {}
export class NoHtmlError extends Error {}
export class UnsafeZipError extends Error {}

const HANDOUT_META_FILE = ".handout";
// The pointer to the state a handout's container currently serves — see
// docs/adr/0018-a-handout-serves-one-state-behind-a-pointer.md. It lives
// beside the state directories rather than inside one, so no request path
// can ever reach it: the served root is always `content/<address>/<token>`.
export const STATE_POINTER_FILE = ".handout-state";

// See docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md — not an
// environment variable: configuration in this project has no defaults
// (CLAUDE.md), and this value is too small to be worth one more thing that
// can be missing at start. The same reasoning as the address length, ADR
// 0001.
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

function token() {
  return randomBytes(16).toString("hex");
}

export function paths(config) {
  const root = config.handoutDataDir;
  return {
    content: path.join(root, "content"),
    staging: path.join(root, "staging"),
    incoming: path.join(root, "incoming"),
    pending: path.join(root, "pending"),
  };
}

export async function ensureDataDirs(config) {
  const dirs = paths(config);
  await Promise.all(
    Object.values(dirs).map((dir) => fsp.mkdir(dir, { recursive: true })),
  );
}

// Streams an incoming upload to disk while counting bytes, aborting the
// moment the ceiling is passed and cleaning up the partial file — the same
// cleanup applies to a stream that simply breaks off mid-transfer.
export function acceptUpload({ filename, stream, config }) {
  return new Promise((resolve, reject) => {
    const dirs = paths(config);
    const uploadToken = token();
    const targetPath = path.join(dirs.incoming, uploadToken);
    const out = fs.createWriteStream(targetPath);
    let bytes = 0;
    let settled = false;

    function cleanupAndReject(err) {
      if (settled) return;
      settled = true;
      stream.unpipe(out);
      out.destroy();
      fsp.rm(targetPath, { force: true }).finally(() => reject(err));
    }

    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > config.maxUploadBytes) {
        cleanupAndReject(
          new TooLargeError("Upload exceeds the configured ceiling"),
        );
      }
    });
    stream.on("error", (err) => cleanupAndReject(err));
    out.on("error", (err) => cleanupAndReject(err));
    out.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({ token: uploadToken, path: targetPath, size: bytes, filename });
    });

    stream.pipe(out);
  });
}

const MAGIC = {
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  pdf: Buffer.from("%PDF-", "ascii"),
};

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

export function detectKind(filename, firstBytes) {
  const ext = extensionOf(filename);
  if (ext === "zip") {
    if (firstBytes.slice(0, 4).equals(MAGIC.zip)) return "zip";
    throw new UnsupportedError(
      "File extension .zip does not match its content",
    );
  }
  if (ext === "pdf") {
    if (firstBytes.slice(0, 5).equals(MAGIC.pdf)) return "pdf";
    throw new UnsupportedError(
      "File extension .pdf does not match its content",
    );
  }
  if (ext === "html" || ext === "htm") {
    return "html";
  }
  throw new UnsupportedError(`Unsupported file type: ${ext || filename}`);
}

function topLevelDir(name) {
  const idx = name.indexOf("/");
  return idx === -1 ? null : name.slice(0, idx);
}

function basename(name) {
  const idx = name.lastIndexOf("/");
  return idx === -1 ? name : name.slice(idx + 1);
}

// Archive bookkeeping, not artifact content — dropped from the candidate set
// before any of resolveZipEntry's three rules run, so the top-level-directory
// count and the HTML-member count agree on what the archive actually
// contains. This is an implementation detail of ADR 0003's entry rule, not a
// change to it: the ADR only names the rule at the level of "index.html, a
// single wrapper folder, or exactly one HTML member" and says nothing about
// what counts as a member in the first place.
//
// Deliberately NOT used to filter extraction — CLAUDE.md says Handout never
// touches the artifact, and dropping these from what gets written out would
// be exactly that. Everything is extracted as it arrived; this filter exists
// only to decide which member is the entry. None of these files are ever
// referenced by the artifact, so they are simply never served.
function isArchiveNoise(name) {
  if (topLevelDir(name) === "__MACOSX") return true;
  const base = basename(name);
  if (base.startsWith("._")) return true;
  if (base === ".DS_Store") return true;
  if (base === "Thumbs.db") return true;
  if (base === "desktop.ini") return true;
  return false;
}

function isHtmlMember(name) {
  return /\.(html|htm)$/i.test(name);
}

// Fixed locale, fixed comparator: the candidate order is shown to the
// publisher and re-derived on the server-side re-check, so it has to come out
// the same on every machine — a bare localeCompare() does not promise that.
const CANDIDATE_COLLATOR = new Intl.Collator("en", { numeric: true });

function compareCandidates(a, b) {
  const dirA = topLevelDir(a) ? a.slice(0, a.lastIndexOf("/")) : "";
  const dirB = topLevelDir(b) ? b.slice(0, b.lastIndexOf("/")) : "";
  const byDir = CANDIDATE_COLLATOR.compare(dirA, dirB);
  if (byDir !== 0) return byDir;
  return CANDIDATE_COLLATOR.compare(basename(a), basename(b));
}

// The single filter both the entry-choice screen and the server-side
// re-check call (docs/adr/0012) — archive noise removed by the same helper
// resolveZipEntry itself uses, HTML members only, relative to `root`, sorted
// root first then folders alphabetically. There is no second filter and no
// stored copy of this list that could drift from it.
export function entryCandidatesFrom(names, root) {
  const prefix = root ? `${root}/` : "";
  return names
    .filter((name) => !isArchiveNoise(name))
    .filter((name) => isHtmlMember(name))
    .filter((name) => (root ? name.startsWith(prefix) : true))
    .map((name) => (root ? name.slice(prefix.length) : name))
    .sort(compareCandidates);
}

// Four-branch result, in the issue's own order — index.html at the root, a
// single wrapper folder holding it, exactly one HTML member, several HTML
// members (ambiguous), or none at all. See
// docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md, which
// amends ADR 0003's rules 2 and 4.
export function resolveZipEntry(names) {
  const candidates = names.filter((name) => !isArchiveNoise(name));
  const htmlMembers = candidates.filter((name) => isHtmlMember(name));

  if (htmlMembers.length === 0) {
    return { status: "none" };
  }

  if (candidates.includes("index.html")) {
    return { status: "resolved", root: "", entry: "index.html" };
  }

  const topDirs = new Set();
  for (const name of candidates) {
    const dir = topLevelDir(name);
    if (dir) topDirs.add(dir);
  }
  const singleTopDir = topDirs.size === 1 ? [...topDirs][0] : null;
  // The clause a plain "one top-level directory holding index.html" rule
  // does not have: a wrapper folder is only the whole story when every HTML
  // member actually lives inside it. Without this, a multi-page export whose
  // only *folder* happens to hold an index.html (while its real pages sit at
  // the root) would silently resolve to that folder and hide the pages.
  const allHtmlUnderSingleTopDir =
    singleTopDir !== null &&
    htmlMembers.every((name) => topLevelDir(name) === singleTopDir);

  if (
    allHtmlUnderSingleTopDir &&
    candidates.includes(`${singleTopDir}/index.html`)
  ) {
    return { status: "resolved", root: singleTopDir, entry: "index.html" };
  }

  if (htmlMembers.length === 1) {
    const [member] = htmlMembers;
    const dir = topLevelDir(member);
    const entry = dir ? member.slice(dir.length + 1) : member;
    return { status: "resolved", root: dir || "", entry };
  }

  // A wrapper folder is still recognised as the root in the ambiguous case —
  // the choice only ever fixes `entry`, never `root` — but only when it
  // truly wraps every HTML member; otherwise a candidate outside it would be
  // silently dropped from the list.
  const root = allHtmlUnderSingleTopDir ? singleTopDir : "";
  return {
    status: "ambiguous",
    root,
    candidates: entryCandidatesFrom(names, root),
  };
}

export function assertSafeMember(name) {
  if (name.startsWith("/") || name.includes("\\")) {
    throw new UnsafeZipError(`Unsafe zip member: ${name}`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new UnsafeZipError(`Unsafe zip member: ${name}`);
  }
}

// yauzl validates member names itself and emits a plain Error on the zipfile
// for exactly the cases ADR 0003 wants rejected (absolute path, ".." segment,
// invalid characters) — fold those into our own UnsafeZipError rather than
// letting them surface as an unhandled 500.
function asUnsafeZipError(err) {
  if (
    err instanceof Error &&
    /^(invalid relative path|absolute path|invalid characters in fileName):/.test(
      err.message,
    )
  ) {
    return new UnsafeZipError(err.message);
  }
  return err;
}

function openZip(sourcePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      sourcePath,
      { lazyEntries: true, autoClose: false },
      (err, zipfile) => {
        if (err) reject(err);
        else resolve(zipfile);
      },
    );
  });
}

async function listZipMembers(sourcePath) {
  const zipfile = await openZip(sourcePath);
  const names = [];
  await new Promise((resolve, reject) => {
    zipfile.on("entry", (entry) => {
      names.push(entry.fileName);
      zipfile.readEntry();
    });
    zipfile.on("end", resolve);
    zipfile.on("error", (err) => reject(asUnsafeZipError(err)));
    zipfile.readEntry();
  });
  zipfile.close();
  return names;
}

async function extractZip(sourcePath, destinationDir) {
  const zipfile = await openZip(sourcePath);
  await new Promise((resolve, reject) => {
    zipfile.on("error", (err) => reject(asUnsafeZipError(err)));
    zipfile.on("entry", (entry) => {
      const name = entry.fileName;
      try {
        assertSafeMember(name);
      } catch (err) {
        zipfile.close();
        reject(err);
        return;
      }

      const targetPath = path.resolve(destinationDir, name);
      if (
        !targetPath.startsWith(path.resolve(destinationDir) + path.sep) &&
        targetPath !== path.resolve(destinationDir)
      ) {
        zipfile.close();
        reject(new UnsafeZipError(`Unsafe zip member: ${name}`));
        return;
      }

      const isDirectory = name.endsWith("/");
      if (isDirectory) {
        fsp
          .mkdir(targetPath, { recursive: true })
          .then(() => zipfile.readEntry())
          .catch(reject);
        return;
      }

      fsp
        .mkdir(path.dirname(targetPath), { recursive: true })
        .then(
          () =>
            new Promise((res, rej) => {
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) return rej(err);
                const writeStream = fs.createWriteStream(targetPath);
                readStream.on("error", rej);
                writeStream.on("error", rej);
                writeStream.on("finish", res);
                readStream.pipe(writeStream);
              });
            }),
        )
        .then(() => zipfile.readEntry())
        .catch(reject);
    });
    zipfile.on("end", resolve);
    zipfile.readEntry();
  });
  zipfile.close();
}

function sanitiseFilename(filename) {
  return path.basename(filename).replace(/[/\\]/g, "_");
}

// Builds a staging directory holding the artifact exactly as it arrived, plus
// the .handout metadata file. Returns the staging token so the caller decides
// when (and whether) to promote it to a live address.
// materialise either returns a staging directory or leaves nothing behind —
// the directory is this function's own, created as its first act, so a
// throw from anything after that (an unsafe member, an entryless zip) is
// this function's own to clean up before the caller ever sees the token to
// clean it up with themselves. An *ambiguous* zip is not a throw: the
// staging directory is returned with `entry: null` and survives — the
// caller (the ambiguous branch in the publisher route) owns it from here.
export async function materialise({ kind, sourcePath, filename, config }) {
  const dirs = paths(config);
  const stagingToken = token();
  const stagingDir = path.join(dirs.staging, stagingToken);
  await fsp.mkdir(stagingDir, { recursive: true });

  try {
    let root;
    let entry;

    if (kind === "zip") {
      const names = await listZipMembers(sourcePath);
      for (const name of names) {
        if (!name.endsWith("/")) assertSafeMember(name);
      }
      const resolved = resolveZipEntry(
        names.filter((name) => !name.endsWith("/")),
      );
      if (resolved.status === "none") {
        throw new NoHtmlError("The zip contains no HTML file");
      }
      await extractZip(sourcePath, stagingDir);
      root = resolved.root;
      entry = resolved.status === "ambiguous" ? null : resolved.entry;
    } else {
      const safeName = sanitiseFilename(filename);
      await fsp.copyFile(sourcePath, path.join(stagingDir, safeName));
      root = "";
      entry = safeName;
    }

    const meta = { root, entry, kind, filename };
    await fsp.writeFile(
      path.join(stagingDir, HANDOUT_META_FILE),
      JSON.stringify(meta),
      "utf8",
    );

    return { token: stagingToken, ...meta };
  } catch (err) {
    // The cleanup failing must never replace the reason materialise itself
    // failed — swallow it (logged, not thrown) and let the original error
    // propagate.
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// readMeta's counterpart for a staging directory rather than a promoted
// address — used to check whether an entry has actually been chosen before
// promoting (a `null` entry reaching content/ would 500 on the first view).
export async function readStagingMeta(config, stagingToken) {
  const dirs = paths(config);
  const raw = await fsp.readFile(
    path.join(dirs.staging, stagingToken, HANDOUT_META_FILE),
    "utf8",
  );
  return JSON.parse(raw);
}

// Rewrites the staging .handout with the chosen entry, once the publisher's
// selection has been re-checked (a non-empty member of
// stagingEntryCandidates, never taken on faith).
export async function setStagingEntry(config, stagingToken, entry) {
  if (typeof entry !== "string" || entry.trim() === "") {
    throw new Error("setStagingEntry requires a non-empty entry");
  }
  const dirs = paths(config);
  const metaPath = path.join(dirs.staging, stagingToken, HANDOUT_META_FILE);
  const raw = await fsp.readFile(metaPath, "utf8");
  const meta = JSON.parse(raw);
  meta.entry = entry;
  await fsp.writeFile(metaPath, JSON.stringify(meta), "utf8");
}

async function listStagingMembers(stagingDir) {
  const results = [];
  async function walk(dir, prefix) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const dirent of entries) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(path.join(dir, dirent.name), rel);
      } else {
        results.push(rel);
      }
    }
  }
  await walk(stagingDir, "");
  return results;
}

// The one function both the entry-choice screen's render and the
// server-side re-check call (docs/adr/0012) — walks the staging directory
// itself rather than trusting anything handed in, then runs it through the
// same entryCandidatesFrom the initial resolution used.
export async function stagingEntryCandidates(config, stagingToken) {
  const dirs = paths(config);
  const stagingDir = path.join(dirs.staging, stagingToken);
  const raw = await fsp.readFile(
    path.join(stagingDir, HANDOUT_META_FILE),
    "utf8",
  );
  const meta = JSON.parse(raw);
  const names = await listStagingMembers(stagingDir);
  return entryCandidatesFrom(names, meta.root);
}

// The container a handout's states live under — not itself a state
// directory, see docs/adr/0018-a-handout-serves-one-state-behind-a-pointer.md.
export function containerFor(config, address) {
  return path.join(paths(config).content, address);
}

// The token of the state a container currently serves, or `null` when there
// is no pointer at all — either because the address does not exist, or
// because it was written before this layout existed (the legacy on-disk
// case, see ADR 0018). Every other read error propagates; only a missing
// pointer file is a `null`.
export async function readStatePointer(config, address) {
  try {
    const raw = await fsp.readFile(
      path.join(containerFor(config, address), STATE_POINTER_FILE),
      "utf8",
    );
    return raw.trim();
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// The only function allowed to write the pointer. Atomic: write the token to
// a uniquely-named file beside the pointer, then rename it onto the
// pointer's own name — a rename onto an existing file, in the same
// directory, is atomic on POSIX, so a reader never observes a
// half-written pointer.
export async function writeStatePointer(config, address, token) {
  const container = containerFor(config, address);
  const tmpPath = path.join(
    container,
    `${STATE_POINTER_FILE}.${randomBytes(8).toString("hex")}`,
  );
  await fsp.writeFile(tmpPath, token, "utf8");
  await fsp.rename(tmpPath, path.join(container, STATE_POINTER_FILE));
}

// Resolves an address to the state directory a request should read from,
// right now. With a pointer: the directory it names. Without one: the
// container itself, which is what a handout written before this layout
// existed looks like on disk (ADR 0018's legacy fallback). Never throws for
// an address nothing was ever published under — the caller finds that out
// from a missing `.handout`, exactly as before.
export async function resolveState(config, address) {
  const container = containerFor(config, address);
  const pointerToken = await readStatePointer(config, address);
  if (pointerToken) {
    return { dir: path.join(container, pointerToken), id: pointerToken };
  }
  return { dir: container, id: address };
}

// readMeta's replacement: reads a state's own .handout rather than an
// address's, since an address no longer names a single directory of
// content on its own. `null` on ENOENT, as readMeta always was.
export async function readMetaFrom(stateDir) {
  try {
    const raw = await fsp.readFile(
      path.join(stateDir, HANDOUT_META_FILE),
      "utf8",
    );
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Moves a staging directory into an address's container, keyed by its own
// staging token — which becomes the state's token. The staging token is
// already 32 random hex characters, so it can never collide with an address
// (10 characters, ADR 0001) or with the pointer file's own name. The state
// is on disk after this call but served to nobody until the pointer names
// it.
export async function stageStateInto(config, address, stagingToken) {
  const dirs = paths(config);
  await fsp.rename(
    path.join(dirs.staging, stagingToken),
    path.join(containerFor(config, address), stagingToken),
  );
}

// A first publish: creates the container (must not yet exist — `mkdir`
// without `recursive`, so a colliding address throws exactly as
// `promoteToContent`'s rename onto an existing path used to), stages the
// state into it, then points at it. Replaces `promoteToContent`.
export async function installFirstState(config, stagingToken, address) {
  await fsp.mkdir(containerFor(config, address));
  await stageStateInto(config, address, stagingToken);
  await writeStatePointer(config, address, stagingToken);
}

// Removes every entry in an address's container except the pointer file and
// the state directory the pointer currently names — re-reading the pointer
// at the moment it runs, which is what keeps two concurrent uploads to the
// same address from deleting each other's live state: whichever finished
// last is the one this sees and keeps. A failure on a single entry is
// swallowed, exactly as sweepAbandoned already does — a stray directory left
// behind is cleaned up by the next update of this same handout, never worth
// failing the request that just succeeded.
export async function pruneStates(config, address) {
  const container = containerFor(config, address);
  const current = await readStatePointer(config, address);
  let entries;
  try {
    entries = await fsp.readdir(container);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === STATE_POINTER_FILE || name === current) continue;
    try {
      await fsp.rm(path.join(container, name), {
        recursive: true,
        force: true,
      });
    } catch {
      // A single stale or already-removed entry must never stop the prune.
    }
  }
}

export async function removeStaging(config, stagingToken) {
  const dirs = paths(config);
  await fsp.rm(path.join(dirs.staging, stagingToken), {
    recursive: true,
    force: true,
  });
}

export async function removeContent(config, address) {
  const dirs = paths(config);
  await fsp.rm(path.join(dirs.content, address), {
    recursive: true,
    force: true,
  });
}

// The pending publish — title, protect flag, password, owner and filename —
// for an ambiguous upload. Lives beside the staging directory rather than in
// the database: the domain has two entities and no room for a third
// (CLAUDE.md). See docs/adr/0012-choose-a-zips-entry-page-when-it-is-ambiguous.md.
function pendingFile(config, stagingToken) {
  return path.join(paths(config).pending, `${stagingToken}.json`);
}

export async function writePending(config, stagingToken, record) {
  await fsp.writeFile(
    pendingFile(config, stagingToken),
    JSON.stringify(record),
    "utf8",
  );
}

export async function readPending(config, stagingToken) {
  try {
    const raw = await fsp.readFile(pendingFile(config, stagingToken), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function removePending(config, stagingToken) {
  await fsp.rm(pendingFile(config, stagingToken), { force: true });
}

// Removes anything under pending/, staging/ or incoming/ older than
// ABANDONED_AFTER_MS — a publisher who closes the tab on the entry-choice
// screen leaves exactly a pending record plus a staging directory behind;
// sweeping incoming/ too catches a stream that broke off mid-upload, at no
// extra cost. Never throws: a failing sweep must never fail a publish or a
// start, so a per-entry error is swallowed and the entry is simply left for
// next time.
export async function sweepAbandoned(config) {
  const dirs = paths(config);
  const cutoff = Date.now() - ABANDONED_AFTER_MS;
  const removed = [];
  for (const dir of [dirs.pending, dirs.staging, dirs.incoming]) {
    let entries;
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const entryPath = path.join(dir, name);
      try {
        const stat = await fsp.stat(entryPath);
        if (stat.mtimeMs < cutoff) {
          await fsp.rm(entryPath, { recursive: true, force: true });
          removed.push(entryPath);
        }
      } catch {
        // A single stale or already-removed entry must never stop the sweep.
      }
    }
  }
  return removed;
}
