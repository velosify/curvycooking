# curvycooking-api

Fastify + Postgres backend deployed on Railway. Handles signup, login, session
cookies, and the Stripe webhook that marks paying customers as `paid` and
issues one-time signup tokens.

## Deploy on Railway

1. In your Railway project, attach a **PostgreSQL** service. Railway will inject
   `DATABASE_URL` into this app automatically.
2. Set the curvycooking service's **Root Directory** to `/server` (Settings → Source).
3. Set these env vars on the curvycooking service (Settings → Variables):
   - `JWT_SECRET`: generate with `openssl rand -base64 48`
   - `STRIPE_SECRET_KEY`: `sk_live_…` from Stripe Dashboard → Developers → API keys
   - `STRIPE_WEBHOOK_SECRET`: `whsec_…` (see step 5)
   - `FRONTEND_ORIGIN`: `https://curvycooking.com`
   - `COOKIE_DOMAIN`: `.curvycooking.com` (note leading dot for cross-subdomain)
   - `NODE_ENV`: `production`
   - `RESEND_API_KEY`: `re_…` from Resend Dashboard → API Keys (optional; emails are logged if missing)
   - `EMAIL_FROM`: verified sending address, e.g. `hello@curvycooking.com`
   - `EMAIL_FROM_NAME`: optional display name, e.g. `Ashley at Curvy Cooking`
   - `EMAIL_REPLY_TO`: optional reply-to address (defaults to EMAIL_FROM)
4. Generate a public domain: Settings → Networking → Generate Domain.
5. In Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   - URL: `https://your-railway-domain.up.railway.app/webhooks/stripe`
   - Event: `payment_intent.succeeded`
   - Copy the Signing secret (`whsec_…`) into Railway as `STRIPE_WEBHOOK_SECRET`.

## Routes

| Method | Path                | Purpose                                                    |
|--------|---------------------|------------------------------------------------------------|
| GET    | `/health`           | Liveness probe                                             |
| POST   | `/auth/signup`      | `{email, password, name, signupToken}`, paid-gated         |
| POST   | `/auth/login`       | `{email, password}`, returns session cookie                |
| GET    | `/auth/me`          | Verifies cookie, returns `{user}` or 401                   |
| POST   | `/auth/logout`      | Clears cookie                                              |
| GET    | `/auth/lookup`      | `?token=&email=` validates magic link before signup form   |
| POST   | `/webhooks/stripe`  | Stripe-signed webhook                                      |

## Database

Single `users` table, schema lives in `src/migrate.js` and runs on every boot.

```
users (
  id, email (CITEXT UNIQUE), password_hash, name,
  paid_at, payment_intent,
  signup_token, signup_token_expires_at,
  created_at, updated_at
)
```

Flow:
1. Customer pays → Stripe webhook inserts row with `paid_at` set, `password_hash` null, `signup_token` set.
2. We email them the link `https://curvycooking.com/login?token=...&email=...`.
3. They click → frontend calls `/auth/lookup` to validate, shows password form.
4. They set password → `/auth/signup` writes `password_hash`, clears the token, sets session cookie.
5. Future logins use `/auth/login` + email/password.
