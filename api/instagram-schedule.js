import { supabaseAdmin } from "./_ig_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-publish-secret"];
  if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { imageUrl, caption, scheduledFor } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });
  if (!scheduledFor) return res.status(400).json({ error: "scheduledFor is required (ISO datetime)" });

  const { data, error } = await supabaseAdmin
    .from("scheduled_posts")
    .insert({ image_url: imageUrl, caption: caption || "", scheduled_for: scheduledFor, status: "pending" })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ success: true, id: data.id, scheduledFor: data.scheduled_for });
}
