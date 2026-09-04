import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeFor } from "../mime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

export default async function staticRoutes(fastify) {
  fastify.get("/static/*", async (request, reply) => {
    const requested = request.params["*"];
    const decoded = decodeURIComponent(requested);
    const targetPath = path.resolve(PUBLIC_DIR, decoded);

    if (
      targetPath !== PUBLIC_DIR &&
      !targetPath.startsWith(PUBLIC_DIR + path.sep)
    ) {
      return reply.code(404).send();
    }

    let stat;
    try {
      stat = await fsp.stat(targetPath);
    } catch {
      return reply.code(404).send();
    }
    if (!stat.isFile()) {
      return reply.code(404).send();
    }

    const contentType = contentTypeFor(targetPath);
    reply.header("content-type", contentType);
    reply.header("content-length", String(stat.size));
    if (targetPath.includes(`${path.sep}fonts${path.sep}`)) {
      reply.header("cache-control", "public, max-age=604800");
    } else {
      reply.header("cache-control", "no-cache");
    }
    // A stream reply must be returned, not merely sent: an async handler
    // that resolves before the stream finishes otherwise races Fastify's
    // own completion of the (still-empty) reply.
    return reply.send(fs.createReadStream(targetPath));
  });
}
