import { supabaseAdmin } from "./_ig_lib.js";

export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { data, error } = await supabaseAdmin
    .from("scheduled_posts")
    .select("*")
    .eq("status", "draft")
    .order("scheduled_for", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ drafts: data });
}
