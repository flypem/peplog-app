import { supabase } from "./supabaseClient";

async function authedFetch(path, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body || {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request to ${path} failed: ${text}`);
  }
  return res.json();
}

// Redirects the browser to Stripe Checkout for the Pro subscription.
// interval: "monthly" | "annual"
export async function startCheckout(interval = "monthly") {
  const { url } = await authedFetch("/api/create-checkout-session", {
    interval,
    successUrl: `${window.location.origin}/?checkout=success`,
    cancelUrl: `${window.location.origin}/?checkout=cancelled`,
  });
  window.location.href = url;
}

// Redirects the browser to the Stripe Customer Portal, where the user
// can update payment info or cancel — you don't build cancellation UI yourself.
export async function openBillingPortal() {
  const { url } = await authedFetch("/api/create-portal-session", {
    returnUrl: `${window.location.origin}/`,
  });
  window.location.href = url;
}
