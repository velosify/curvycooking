// Cloudflare Pages Function: GET /api/payment-intent-status?id=pi_xxx
//
// After Stripe redirects the customer to /thanks?payment_intent=pi_xxx&...
// the thanks page calls this endpoint to verify the payment really cleared.
// Don't trust browser URL params alone — anyone could craft a fake redirect.

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !id.startsWith("pi_")) {
    return json({ error: "Missing or invalid payment intent id" }, 400);
  }

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/payment_intents/${id}`,
    { headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );

  if (!stripeRes.ok) {
    return json({ error: "Payment intent not found" }, 404);
  }

  const pi = await stripeRes.json();

  return json({
    status:         pi.status,                     // succeeded | processing | requires_payment_method | canceled | etc.
    amount:         pi.amount,                     // in cents
    currency:       pi.currency,
    receipt_email:  pi.receipt_email || null,
    customer_email: pi.charges?.data?.[0]?.billing_details?.email || pi.receipt_email || null,
    customer_name:  pi.charges?.data?.[0]?.billing_details?.name || null,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
