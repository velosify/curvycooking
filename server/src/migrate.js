// One-shot schema setup. Idempotent. Safe to run on every deploy via the
// `migrate` script or on first boot below.
import { query } from "./db.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  email           CITEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  name            TEXT,
  paid_at         TIMESTAMPTZ,
  payment_intent  TEXT,
  signup_token    TEXT UNIQUE,
  signup_token_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_signup_token ON users (signup_token);

-- Added 2026-05-14: password reset support
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);
`;

export async function runMigrations() {
  // Postgres ships CITEXT in an extension; enable it first.
  await query(`CREATE EXTENSION IF NOT EXISTS citext;`);
  await query(SCHEMA);
  console.log("[migrate] schema ready");
}

// Run directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate failed]", err);
      process.exit(1);
    });
}
