// Cloudflare Pages Function: POST /api/create-payment-intent
//
// Creates a Stripe Payment Intent for the Curvy Cookbook ($19) and returns
// the client_secret so the browser can mount Stripe Elements and collect
// payment details directly. We use a hard-coded amount/currency rather than
// looking up STRIPE_PRICE_ID because Payment Intents take amount in cents
// directly — Prices belong to the Checkout Session API.
//
// Required env vars:
//   STRIPE_SECRET_KEY  e.g. sk_live_xxx

const AMOUNT_CENTS = 1900;   // $19.00
const CURRENCY     = "usd";
const DESCRIPTION  = "Curvy Cookbook";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Server is missing Stripe secret key." }, 500);
  }

  let body = {};
  try { body = await request.json(); } catch (e) { /* allow empty */ }
  const email = (body.email || "").trim();

  const params = new URLSearchParams();
  params.set("amount", String(AMOUNT_CENTS));
  params.set("currency", CURRENCY);
  params.set("description", DESCRIPTION);
  params.set("automatic_payment_methods[enabled]", "true");
  params.set("metadata[product]", "curvy-cookbook");
  params.set("metadata[source]", "elements");
  if (email) params.set("receipt_email", email);

  const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await stripeRes.json();

  if (!stripeRes.ok) {
    console.error("Stripe error", JSON.stringify(data));
    const msg = data?.error?.message || data?.error?.code || `Stripe API ${stripeRes.status}`;
    return json({ error: msg, code: data?.error?.code, type: data?.error?.type }, 502);
  }

  return json({
    client_secret: data.client_secret,
    payment_intent_id: data.id,
    amount: data.amount,
    currency: data.currency,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
