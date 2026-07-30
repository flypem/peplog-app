import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Server-side Supabase client using the SERVICE ROLE key — this bypasses
// Row Level Security, which is exactly why it must only ever run here
// (in a serverless function) and never be shipped to the browser.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verifies the Supabase JWT sent from the browser and returns the user,
// so these endpoints know who's asking without trusting a client-supplied id.
export async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data.user;
}
