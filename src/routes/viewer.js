import {
  resolveLabel,
  forwardedHost,
  requestOrigin,
  safeReturnTo,
} from "../host.js";
import { renderPasswordPage } from "../views/password.js";
import { passwordMatches } from "../password.js";
import {
  loadProtection,
  writeUnlock,
  readNext,
  clearNext,
} from "../protection.js";

export default async function viewerRoutes(fastify) {
  const { config, pool } = fastify;

  fastify.get("/.handout/password", async (request, reply) => {
    const label = resolveLabel(forwardedHost(request.headers));
    const row = label ? await loadProtection(pool, label) : null;
    if (!row || !row.password) {
      return reply.code(303).header("location", "/").send();
    }
    return reply
      .code(401)
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(renderPasswordPage({ error: false, config }));
  });

  fastify.post("/.handout/password", async (request, reply) => {
    const label = resolveLabel(forwardedHost(request.headers));
    const row = label ? await loadProtection(pool, label) : null;
    if (!row || !row.password) {
      return reply.code(303).header("location", "/").send();
    }

    const given = String(request.body?.password ?? "");
    if (!passwordMatches(given, row.password)) {
      await fastify.throttle.penalise(`${label}|${request.ip}`);
      return reply
        .code(401)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .send(renderPasswordPage({ error: true, config }));
    }

    fastify.throttle.clear(`${label}|${request.ip}`);
    writeUnlock(reply, config, label, row.password);
    const target = safeReturnTo(
      readNext(request, config),
      requestOrigin(request),
    );
    clearNext(reply);
    return reply.code(303).header("location", target).send();
  });
}
