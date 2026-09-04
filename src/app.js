import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import { resolveLabel, forwardedHost } from "./host.js";
import { serveContent } from "./content.js";
import publisherRoutes from "./routes/publisher.js";
import authRoutes from "./routes/auth.js";
import staticRoutes from "./routes/static.js";

export function buildServer(config, { pool, oidcConfig }) {
  // forceCloseConnections: a test suite's fetch() keeps its sockets alive,
  // which would otherwise make fastify.close() wait out the keep-alive
  // timeout on every teardown.
  const fastify = Fastify({ trustProxy: true, forceCloseConnections: true });

  fastify.decorate("config", config);
  fastify.decorate("pool", pool);
  fastify.decorate("oidcConfig", oidcConfig);

  fastify.register(fastifyCookie, { secret: config.sessionSecret });
  fastify.register(fastifyFormbody);
  fastify.register(fastifyMultipart, { attachFieldsToBody: false });

  fastify.addHook("onRequest", async (request, reply) => {
    const label = resolveLabel(forwardedHost(request.headers));
    if (label) {
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
    }
  });

  fastify.register(publisherRoutes);
  fastify.register(authRoutes);
  fastify.register(staticRoutes);

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
