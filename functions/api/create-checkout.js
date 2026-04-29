// Cloudflare Pages Function: POST /api/create-checkout
// Creates a Stripe Checkout Session in `embedded` UI mode and returns the
// `client_secret` that the browser uses to mount the checkout form inline.
//
// Required env vars (set in Cloudflare Pages → Settings → Environment variables):
//   STRIPE_SECRET_KEY  e.g. sk_live_xxx        — secret, never exposed to browser
//   STRIPE_PRICE_ID    e.g. price_xxx          — your Curvy Cookbook price
//   PUBLIC_BASE_URL    e.g. https://curvycooking.com  — base for return_url

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID || !env.PUBLIC_BASE_URL) {
    return json({ error: "Server is missing Stripe configuration." }, 500);
  }

  // Optional inputs from the page (we don't strictly need them — Stripe collects
  // email itself in embedded mode — but accepting them is harmless).
  let body = {};
  try { body = await request.json(); } catch (e) { /* allow empty body */ }

  const params = new URLSearchParams();
  params.set("ui_mode", "embedded");
  params.set("mode", "payment");
  params.set("line_items[0][price]", env.STRIPE_PRICE_ID);
  params.set("line_items[0][quantity]", "1");
  params.set("return_url", `${env.PUBLIC_BASE_URL}/thanks?session_id={CHECKOUT_SESSION_ID}`);
  params.set("automatic_tax[enabled]", "true");
  params.set("billing_address_collection", "required");
  params.set("phone_number_collection[enabled]", "false");
  params.set("allow_promotion_codes", "true");

  // Useful metadata for fulfillment / debugging
  params.set("metadata[product]", "curvy-cookbook");
  params.set("metadata[source]", "embedded-checkout");

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await stripeRes.json();

  if (!stripeRes.ok) {
    console.error("Stripe error", data);
    return json({ error: data?.error?.message || "Stripe request failed" }, 502);
  }

  return json({ client_secret: data.client_secret });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
