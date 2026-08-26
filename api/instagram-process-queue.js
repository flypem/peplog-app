import { supabaseAdmin, getInstagramCredentials } from "./_ig_lib.js";
import { publishToInstagram } from "./_ig_publish.js";

export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const creds = await getInstagramCredentials();
  if (!creds || !creds.access_token) {
    return res.status(400).json({ error: "Instagram isn't connected yet." });
  }

  const { data: due, error: fetchError } = await supabaseAdmin
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true });

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!due || due.length === 0) {
    return res.status(200).json({ processed: 0, message: "Nothing due right now." });
  }

  const results = [];
  for (const post of due) {
    try {
      const urls = post.image_urls && post.image_urls.length > 0 ? post.image_urls : [post.image_url];
      const postId = await publishToInstagram({
        igUserId: creds.ig_user_id,
        accessToken: creds.access_token,
        imageUrls: urls,
        caption: post.caption,
      });
      await supabaseAdmin.from("scheduled_posts").update({ status: "posted", post_id: postId }).eq("id", post.id);
      results.push({ id: post.id, status: "posted", postId, images: urls.length });
    } catch (err) {
      await supabaseAdmin.from("scheduled_posts").update({ status: "failed", error: err.message }).eq("id", post.id);
      results.push({ id: post.id, status: "failed", error: err.message });
    }
  }

  res.status(200).json({ processed: results.length, results });
}
