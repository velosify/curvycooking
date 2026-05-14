// Postgres connection pool. Railway injects DATABASE_URL when you attach a
// PostgreSQL service to this app.
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[fatal] DATABASE_URL is not set. Attach a Railway Postgres service.");
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("[pg pool error]", err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
