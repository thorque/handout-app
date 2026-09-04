import pg from "pg";

const { Pool } = pg;

export function createPool(config) {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
