// Stops the process on SIGTERM and SIGINT instead of leaving it to be killed
// when `docker stop` runs out of patience. The server closes first so nothing
// new reaches the pool, then the pool, then the process exits.
//
// buildServer sets forceCloseConnections, so fastify.close() does not wait out
// keep-alive sockets. That is what lets this finish well inside the ten
// seconds `docker stop` allows.
export function installShutdownHandlers({
  fastify,
  pool,
  signals = ["SIGTERM", "SIGINT"],
  target = process,
}) {
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await fastify.close();
      await pool.end();
    } catch (err) {
      console.error(err);
      target.exit(1);
      return;
    }
    target.exit(0);
  };

  for (const signal of signals) {
    target.on(signal, stop);
  }
}
