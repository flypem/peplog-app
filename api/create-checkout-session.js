import { stripe, supabaseAdmin, getUserFromRequest } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  const { successUrl, cancelUrl, interval } = req.body || {};
  const priceId = interval === "annual" ? process.env.STRIPE_PRICE_ID_ANNUAL : process.env.STRIPE_PRICE_ID_MONTHLY;
  if (!priceId) return res.status(400).json({ error: `Missing price id for interval "${interval}"` });

  // Reuse an existing Stripe customer if we already made one for this user.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await supabaseAdmin
      .from("profiles")
      .upsert({ user_id: user.id, email: user.email, stripe_customer_id: customerId }, { onConflict: "user_id" });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Belt-and-suspenders: also stamp the user id on the subscription itself,
    // in case a customer somehow gets detached from its metadata later.
    subscription_data: { metadata: { supabase_user_id: user.id } },
  });

  res.status(200).json({ url: session.url });
}
