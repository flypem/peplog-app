import { supabase } from "./supabaseClient";

// Drop-in replacements for the window.storage.get/set calls used in the
// original artifact. Same shape (async, key + fallback), backed by a
// per-user key/value table in Supabase instead of the artifact sandbox.
//
// NOTE: this covers app data (vials, log, custom sites). Subscription
// `plan` is intentionally NOT stored here — see profile.js. If it were
// stored in this same user-writable table, anyone could open devtools
// and set their own plan to "pro" for free.

export async function loadKey(key, fallback) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fallback;

  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return fallback;
  return data.value;
}

export async function saveKey(key, value) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return;

  const { error } = await supabase.from("kv_store").upsert(
    {
      user_id: user.id,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" }
  );

  if (error) {
    // eslint-disable-next-line no-console
    console.error("storage save failed", error);
  }
}
