import { stripe, supabaseAdmin, getUserFromRequest } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  const { returnUrl } = req.body || {};

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: "No billing account yet — subscribe first." });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: returnUrl,
  });

  res.status(200).json({ url: session.url });
}
