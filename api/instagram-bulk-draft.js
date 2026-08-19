import { supabaseAdmin } from "./_ig_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-publish-secret"];
  if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { posts } = req.body || {};
  if (!Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: "posts must be a non-empty array of {imageUrl, caption, scheduledFor}" });
  }

  const rows = posts.map((p) => ({
    image_url: p.imageUrl,
    caption: p.caption || "",
    scheduled_for: p.scheduledFor,
    status: "draft",
  }));

  const { data, error } = await supabaseAdmin.from("scheduled_posts").insert(rows).select();
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ success: true, count: data.length });
}
