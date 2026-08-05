import { supabase } from "./supabaseClient";

// The subscription plan is authoritative server-side: only the Stripe
// webhook (using the service-role key, never shipped to the browser)
// is allowed to write it. The client can only read its own row.
export async function fetchPlan() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { plan: "free", cancelAtPeriodEnd: false, currentPeriodEnd: null };

  const { data, error } = await supabase
    .from("profiles")
    .select("plan, cancel_at_period_end, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return { plan: "free", cancelAtPeriodEnd: false, currentPeriodEnd: null };
  return {
    plan: data.plan || "free",
    cancelAtPeriodEnd: !!data.cancel_at_period_end,
    currentPeriodEnd: data.current_period_end,
  };
}

export async function ensureProfileExists() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return;

  // Safe to call every login — the DB has a unique constraint on user_id,
  // so this only inserts a row the very first time.
  await supabase
    .from("profiles")
    .upsert({ user_id: user.id, email: user.email }, { onConflict: "user_id", ignoreDuplicates: true });
}
