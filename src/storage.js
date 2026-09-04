import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import yauzl from "yauzl";

export class TooLargeError extends Error {}
export class UnsupportedError extends Error {}
export class NoEntryError extends Error {}
export class UnsafeZipError extends Error {}

const HANDOUT_META_FILE = ".handout";

function token() {
  return randomBytes(16).toString("hex");
}

export function paths(config) {
  const root = config.handoutDataDir;
  return {
    content: path.join(root, "content"),
    staging: path.join(root, "staging"),
    incoming: path.join(root, "incoming"),
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

export function resolveZipEntry(names) {
  const candidates = names.filter((name) => !isArchiveNoise(name));

  if (candidates.includes("index.html")) {
    return { root: "", entry: "index.html" };
  }

  const topDirs = new Set();
  for (const name of candidates) {
    const dir = topLevelDir(name);
    if (dir) topDirs.add(dir);
  }
  if (topDirs.size === 1) {
    const [dir] = topDirs;
    if (candidates.includes(`${dir}/index.html`)) {
      return { root: dir, entry: "index.html" };
    }
  }

  const htmlMembers = candidates.filter((name) => /\.(html|htm)$/i.test(name));
  if (htmlMembers.length === 1) {
    const [member] = htmlMembers;
    const dir = topLevelDir(member);
    const entry = dir ? member.slice(dir.length + 1) : member;
    return { root: dir || "", entry };
  }

  throw new NoEntryError(
    "There is no entry file in the zip. Expected is an index.html in the zip or in a single folder inside it.",
  );
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
// throw from anything after that (an unsafe member, an ambiguous zip) is
// this function's own to clean up before the caller ever sees the token to
// clean it up with themselves.
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
      await extractZip(sourcePath, stagingDir);
      root = resolved.root;
      entry = resolved.entry;
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

export async function promoteToContent(config, stagingToken, address) {
  const dirs = paths(config);
  const stagingDir = path.join(dirs.staging, stagingToken);
  const contentDir = path.join(dirs.content, address);
  await fsp.rename(stagingDir, contentDir);
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

export async function readMeta(config, address) {
  const dirs = paths(config);
  try {
    const raw = await fsp.readFile(
      path.join(dirs.content, address, HANDOUT_META_FILE),
      "utf8",
    );
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export function contentDirFor(config, address) {
  return path.join(paths(config).content, address);
}
