import { resolveLabel } from "../host.js";
import { addressExists } from "../address.js";

// Both sit under the reserved /.handout/ prefix (ADR 0010), the one prefix an
// uploaded artifact can never occupy, so neither can shadow published content.
export const TLS_CHECK_PATH = "/.handout/tls-check";
export const HEALTH_PATH = "/.handout/health";

// The question Caddy asks before it obtains or renews a certificate for a
// hostname it does not know: GET <path>?domain=<the full hostname>, and a 2xx
// allows it. The answer is the address's own existence. The route is for Caddy
// alone: every Caddyfile in this repository blocks it on the public side, and
// an operator's own proxy must do the same.
export default async function operationsRoutes(fastify) {
  const { pool } = fastify;

  fastify.get(HEALTH_PATH, async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      await pool.query("select 1");
    } catch (err) {
      request.log.error(err);
      return reply.code(503).send({ status: "down" });
    }
    return reply.code(200).send({ status: "ok" });
  });

  fastify.get(TLS_CHECK_PATH, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const { domain } = request.query;
    if (typeof domain !== "string" || domain === "") {
      return reply.code(404).send();
    }
    // The label resolution the request path already does, reused as it is.
    const label = resolveLabel(domain);
    if (!label) return reply.code(404).send();
    const exists = await addressExists(pool, label);
    return reply.code(exists ? 204 : 404).send();
  });
}
