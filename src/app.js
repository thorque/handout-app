import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import { resolveLabel, forwardedHost } from "./host.js";
import { serveContent } from "./content.js";
import { isViewerPath } from "./protection.js";
import { createThrottle } from "./throttle.js";
import publisherRoutes from "./routes/publisher.js";
import authRoutes from "./routes/auth.js";
import staticRoutes from "./routes/static.js";
import viewerRoutes from "./routes/viewer.js";

export function buildServer(
  config,
  { pool, oidcConfig, throttle = createThrottle() },
) {
  // forceCloseConnections: a test suite's fetch() keeps its sockets alive,
  // which would otherwise make fastify.close() wait out the keep-alive
  // timeout on every teardown.
  const fastify = Fastify({ trustProxy: true, forceCloseConnections: true });

  fastify.decorate("config", config);
  fastify.decorate("pool", pool);
  fastify.decorate("oidcConfig", oidcConfig);
  fastify.decorate("throttle", throttle);

  fastify.register(fastifyCookie, { secret: config.sessionSecret });
  fastify.register(fastifyFormbody);
  fastify.register(fastifyMultipart, { attachFieldsToBody: false });

  fastify.addHook("onRequest", async (request, reply) => {
    const label = resolveLabel(forwardedHost(request.headers));
    if (!label) return;
    // Handout's own viewer-side pages and assets live under exactly one
    // reserved prefix (ADR 0010); everything else under an address is the
    // artifact's, so it must not be reachable here. Falling through here
    // (rather than answering inside the hook) is also what lets
    // @fastify/formbody parse the password POST — a body is not parsed in
    // an onRequest hook.
    if (isViewerPath(request.url)) return;
    // serveContent calls reply.send() itself, which schedules the actual
    // write asynchronously without marking the reply sent right away.
    // Left alone, Fastify would still run the route behind this hook (the
    // publisher's "/") once this hook resolves, and its requireUser would
    // redirect on top of the content already under way — hijack() makes
    // reply.sent read true immediately so that doesn't happen. It has to
    // come after the send() call, not before: hijacking first makes
    // reply.sent already true when serveContent calls send(), and send()
    // silently skips a reply it thinks is already sent.
    await serveContent(request, reply, label, pool, config);
    reply.hijack();
  });

  fastify.register(publisherRoutes);
  fastify.register(authRoutes);
  fastify.register(staticRoutes);
  fastify.register(viewerRoutes);

  // A response already sent (e.g. a stream reply) can still have a
  // straggling async error surface against the same request afterwards.
  // Fastify's default handler would try to write the error response again
  // and crash on "headers already sent" — once headers are out, there is
  // nothing left to do but log it.
  fastify.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      request.log.error(error);
      return;
    }
    reply.send(error);
  });

  return fastify;
}
