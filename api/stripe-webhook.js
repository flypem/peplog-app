import { stripe, supabaseAdmin } from "./_lib.js";

// Stripe signs the webhook body, so we need the raw, untouched bytes to
// verify it — turning off Vercel's automatic JSON parsing for this route.
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const obj = event.data.object;

  try {
    switch (event.type) {
      // Fires right after a successful subscription checkout.
      case "checkout.session.completed": {
        await supabaseAdmin
          .from("profiles")
          .update({ plan: "pro", stripe_subscription_id: obj.subscription })
          .eq("stripe_customer_id", obj.customer);
        break;
      }
      // Fires on renewals, upgrades/downgrades, past_due, trial ending, etc.
      case "customer.subscription.updated": {
        const isActive = ["active", "trialing"].includes(obj.status);
        await supabaseAdmin
          .from("profiles")
          .update({ plan: isActive ? "pro" : "free", stripe_subscription_id: obj.id })
          .eq("stripe_customer_id", obj.customer);
        break;
      }
      // Fires when a subscription is fully cancelled (not just scheduled to cancel).
      case "customer.subscription.deleted": {
        await supabaseAdmin
          .from("profiles")
          .update({ plan: "free" })
          .eq("stripe_customer_id", obj.customer);
        break;
      }
      default:
        break; // ignore anything we don't care about
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }

  res.status(200).json({ received: true });
}
