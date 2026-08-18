import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS, so this file must only ever run
// server-side (inside these API routes), never be imported into frontend code.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function getInstagramCredentials() {
  const { data, error } = await supabaseAdmin
    .from("instagram_credentials")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveInstagramCredentials({ igUserId, accessToken, expiresAt }) {
  const { error } = await supabaseAdmin.from("instagram_credentials").upsert({
    id: 1,
    ig_user_id: igUserId,
    access_token: accessToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
