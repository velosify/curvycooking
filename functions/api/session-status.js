// Cloudflare Pages Function: GET /api/session-status?session_id=cs_xxx
// Returns the Stripe Checkout Session's status & customer info so the
// thanks page can confirm the payment really cleared (don't trust the
// browser redirect alone — anyone could craft a fake URL).

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ error: "Missing or invalid session_id" }, 400);
  }

  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
    { headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );

  if (!stripeRes.ok) {
    return json({ error: "Session not found" }, 404);
  }

  const s = await stripeRes.json();

  return json({
    status: s.status,                            // open | complete | expired
    payment_status: s.payment_status,            // paid | unpaid | no_payment_required
    customer_email: s.customer_details?.email || s.customer_email || null,
    customer_name:  s.customer_details?.name  || null,
    amount_total:   s.amount_total,              // in cents
    currency:       s.currency,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
