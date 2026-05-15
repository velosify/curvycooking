// Curvy Cooking API. Fastify on Railway.
//
// Env vars required:
//   DATABASE_URL                  Auto-injected by Railway Postgres
//   JWT_SECRET                    Long random string (set in Railway)
//   STRIPE_SECRET_KEY             sk_live_... (set in Railway)
//   STRIPE_WEBHOOK_SECRET         whsec_... (set in Railway after creating webhook)
//   FRONTEND_ORIGIN               https://curvycooking.com
//   COOKIE_DOMAIN                 .curvycooking.com    (for cross-subdomain cookies)
//   NODE_ENV=production           Toggles secure cookies + SSL
//   PORT                          Auto-injected by Railway

import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import crypto from "node:crypto";
import { query, pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { sendSignupEmail, sendResetEmail } from "./email.js";

const {
  JWT_SECRET,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  FRONTEND_ORIGIN = "https://curvycooking.com",
  COOKIE_DOMAIN,
  NODE_ENV = "development",
  PORT = 3000,
} = process.env;

if (!JWT_SECRET) {
  console.error("[fatal] JWT_SECRET is required");
  process.exit(1);
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const isProd = NODE_ENV === "production";

const app = Fastify({
  logger: { level: isProd ? "info" : "debug" },
  // Raw body needed for Stripe webhook signature verification
  bodyLimit: 1024 * 1024,
});

await app.register(cors, {
  origin: FRONTEND_ORIGIN,
  credentials: true,
});
await app.register(cookie);

// Capture raw body on the Stripe webhook route only. Stripe signs the raw bytes.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  try {
    req.rawBody = body;
    done(null, JSON.parse(body.toString("utf8")));
  } catch (err) {
    done(err, undefined);
  }
});

// ----- Helpers ----------------------------------------------------------

const COOKIE_NAME = "cc_session";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,         // 30 days
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
};

function signSession(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name || null },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function readSession(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function clean(email) {
  return String(email || "").trim().toLowerCase();
}

function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

// ----- Routes -----------------------------------------------------------

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

// POST /auth/signup { email, password, name, signupToken }
// signupToken is the one-time link we mailed them after Stripe payment.
// If the email matches a paid+token row, we set the password and log them in.
app.post("/auth/signup", async (req, reply) => {
  const { email: rawEmail, password, name, signupToken } = req.body || {};
  const email = clean(rawEmail);

  if (!email)    return reply.code(400).send({ error: "Email is required." });
  if (!password || password.length < 8)
    return reply.code(400).send({ error: "Password must be at least 8 characters." });

  // Find the paid row, if any
  const { rows } = await query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const existing = rows[0];

  if (!existing) {
    return reply.code(403).send({
      error: "We can't find a paid order for that email. If you just bought it, check your email for the signup link.",
    });
  }

  if (existing.password_hash) {
    return reply.code(409).send({
      error: "That account already has a password. Try signing in instead, or use 'Forgot password'.",
    });
  }

  if (!existing.paid_at) {
    return reply.code(403).send({
      error: "We can't find a paid order for that email yet. Hang tight, it can take ~30 seconds after payment.",
    });
  }

  // If a signup token was issued, require it (defends against random signups for paid emails)
  if (existing.signup_token) {
    if (!signupToken || signupToken !== existing.signup_token)
      return reply.code(403).send({ error: "Invalid or missing signup link. Check the email we sent you." });

    if (existing.signup_token_expires_at && new Date(existing.signup_token_expires_at) < new Date())
      return reply.code(403).send({ error: "Signup link expired. Email us and we'll send a new one." });
  }

  const password_hash = await bcrypt.hash(password, 12);

  await query(
    `UPDATE users
       SET password_hash = $1,
           name = COALESCE($2, name),
           signup_token = NULL,
           signup_token_expires_at = NULL,
           updated_at = NOW()
     WHERE id = $3`,
    [password_hash, name || null, existing.id]
  );

  const user = { id: existing.id, email, name: name || existing.name };
  reply.setCookie(COOKIE_NAME, signSession(user), COOKIE_OPTS);
  return { user };
});

// POST /auth/login { email, password }
app.post("/auth/login", async (req, reply) => {
  const email = clean(req.body?.email);
  const password = req.body?.password || "";

  const { rows } = await query(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const u = rows[0];
  if (!u || !u.password_hash) return reply.code(401).send({ error: "Email or password is incorrect." });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return reply.code(401).send({ error: "Email or password is incorrect." });

  reply.setCookie(COOKIE_NAME, signSession(u), COOKIE_OPTS);
  return { user: { id: u.id, email: u.email, name: u.name } };
});

// GET /auth/me. Used by login.html to check existing session.
app.get("/auth/me", async (req, reply) => {
  const session = readSession(req);
  if (!session) return reply.code(401).send({ error: "Not signed in" });

  const { rows } = await query(
    `SELECT id, email, name FROM users WHERE id = $1`,
    [session.sub]
  );
  if (!rows[0]) return reply.code(401).send({ error: "Not signed in" });
  return { user: rows[0] };
});

// POST /auth/logout
app.post("/auth/logout", async (req, reply) => {
  reply.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  return { ok: true };
});

// POST /webhooks/stripe. Stripe signs every event. Verify, then insert/upgrade.
// the user row to "paid" and generate a one-time signup token.
app.post("/webhooks/stripe", async (req, reply) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "Stripe not configured" });
  const sig = req.headers["stripe-signature"];
  if (!sig || !req.rawBody) return reply.code(400).send({ error: "Bad signature" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    app.log.warn({ err: err.message }, "stripe webhook signature failed");
    return reply.code(400).send({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    const email = clean(pi.receipt_email || pi.charges?.data?.[0]?.billing_details?.email);
    const name = pi.charges?.data?.[0]?.billing_details?.name || null;

    if (!email) {
      app.log.warn({ pi: pi.id }, "no email on succeeded PI; skipping insert");
      return { received: true };
    }

    const token = newToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14); // 14 days

    await query(
      `INSERT INTO users (email, name, paid_at, payment_intent, signup_token, signup_token_expires_at)
       VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET paid_at = COALESCE(users.paid_at, NOW()),
             payment_intent = COALESCE(users.payment_intent, EXCLUDED.payment_intent),
             name = COALESCE(users.name, EXCLUDED.name),
             signup_token = COALESCE(users.signup_token, EXCLUDED.signup_token),
             signup_token_expires_at = COALESCE(users.signup_token_expires_at, EXCLUDED.signup_token_expires_at),
             updated_at = NOW()`,
      [email, name, pi.id, token, expires]
    );

    app.log.info({ email, pi: pi.id }, "paid user upserted");

    const signupUrl = `${FRONTEND_ORIGIN}/login?token=${token}&email=${encodeURIComponent(email)}`;
    app.log.info({ signupUrl }, "→ signup link generated");

    // Fire the welcome / signup email
    const sent = await sendSignupEmail({ to: email, name, signupUrl }, app.log);
    if (!sent.ok) {
      app.log.warn({ err: sent.error, signupUrl }, "signup email failed; link logged above for manual delivery");
    }
  }

  return { received: true };
});

// POST /auth/forgot-password { email }
// Always returns 200 OK regardless of whether the email exists; don't leak
// account-existence info. If the email IS registered (and has a password set),
// we generate a 1-hour reset token and log the link.
app.post("/auth/forgot-password", async (req, reply) => {
  const email = clean(req.body?.email);
  if (!email) return reply.code(400).send({ error: "Email is required." });

  const { rows } = await query(
    `SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const u = rows[0];

  // Only issue a reset token to fully-set-up accounts.
  if (u && u.password_hash) {
    const token = newToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await query(
      `UPDATE users
         SET reset_token = $1,
             reset_token_expires_at = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [token, expires, u.id]
    );

    const resetUrl = `${FRONTEND_ORIGIN}/login?reset_token=${token}&email=${encodeURIComponent(u.email)}`;
    app.log.info({ resetUrl, email: u.email }, "→ reset link generated");

    const sent = await sendResetEmail({ to: u.email, resetUrl }, app.log);
    if (!sent.ok) {
      app.log.warn({ err: sent.error, resetUrl }, "reset email failed; link logged above for manual delivery");
    }
  } else {
    app.log.info({ email }, "forgot-password: no matching account (silent success)");
  }

  return { ok: true };
});

// GET /auth/lookup-reset?reset_token=...&email=... validates that the link
// in a reset email is still good before showing the new-password form.
app.get("/auth/lookup-reset", async (req, reply) => {
  const email = clean(req.query?.email);
  const token = req.query?.reset_token;
  if (!email || !token) return reply.code(400).send({ error: "Missing token or email" });

  const { rows } = await query(
    `SELECT email, name, reset_token, reset_token_expires_at, password_hash
       FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const u = rows[0];
  if (!u || !u.reset_token) return reply.code(404).send({ error: "Reset link not valid" });
  if (u.reset_token !== token) return reply.code(403).send({ error: "Reset link not valid" });
  if (u.reset_token_expires_at && new Date(u.reset_token_expires_at) < new Date())
    return reply.code(403).send({ error: "Reset link expired. Request a new one." });

  return { email: u.email, name: u.name };
});

// POST /auth/reset-password { email, reset_token, password }
// Validates the token, writes the new password hash, clears the token,
// signs the user in.
app.post("/auth/reset-password", async (req, reply) => {
  const { email: rawEmail, reset_token, password } = req.body || {};
  const email = clean(rawEmail);

  if (!email || !reset_token)
    return reply.code(400).send({ error: "Missing token or email." });
  if (!password || password.length < 8)
    return reply.code(400).send({ error: "Password must be at least 8 characters." });

  const { rows } = await query(
    `SELECT id, email, name, reset_token, reset_token_expires_at
       FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const u = rows[0];
  if (!u || !u.reset_token || u.reset_token !== reset_token)
    return reply.code(403).send({ error: "Reset link not valid" });
  if (u.reset_token_expires_at && new Date(u.reset_token_expires_at) < new Date())
    return reply.code(403).send({ error: "Reset link expired. Request a new one." });

  const password_hash = await bcrypt.hash(password, 12);
  await query(
    `UPDATE users
       SET password_hash = $1,
           reset_token = NULL,
           reset_token_expires_at = NULL,
           updated_at = NOW()
     WHERE id = $2`,
    [password_hash, u.id]
  );

  reply.setCookie(COOKIE_NAME, signSession(u), COOKIE_OPTS);
  return { user: { id: u.id, email: u.email, name: u.name } };
});

// GET /auth/lookup?token=...&email=... used by /login page to validate the
// magic link from the Stripe email before the user types a password.
app.get("/auth/lookup", async (req, reply) => {
  const email = clean(req.query?.email);
  const token = req.query?.token;
  if (!email || !token) return reply.code(400).send({ error: "Missing token or email" });

  const { rows } = await query(
    `SELECT email, name, signup_token, signup_token_expires_at, password_hash
       FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  const u = rows[0];
  if (!u) return reply.code(404).send({ error: "No order matches that email" });
  if (u.password_hash) return reply.code(409).send({ error: "Account already set up. Please sign in instead." });
  if (u.signup_token !== token) return reply.code(403).send({ error: "Invalid signup link" });
  if (u.signup_token_expires_at && new Date(u.signup_token_expires_at) < new Date())
    return reply.code(403).send({ error: "Signup link expired" });

  return { email: u.email, name: u.name };
});

// ----- Start ------------------------------------------------------------

try {
  await runMigrations();
  await app.listen({ port: Number(PORT), host: "0.0.0.0" });
  app.log.info(`curvycooking-api listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
