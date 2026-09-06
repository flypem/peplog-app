import { supabaseAdmin, getInstagramCredentials } from "./_ig_lib.js";
import { publishToInstagram } from "./_ig_publish.js";

// Processes at most ONE due post per run, not everything due at once — this
// runs every 30 minutes, so if several posts are due around the same time
// they publish spaced out across successive runs instead of all landing in
// the same burst. Deliberate pacing, not a limitation to "fix" later.
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
    .order("scheduled_for", { ascending: true })
    .limit(1);

  if (fetchError) return res.status(500).json({ error: fetchError.message });
  if (!due || due.length === 0) {
    return res.status(200).json({ processed: 0, message: "Nothing due right now." });
  }

  const post = due[0];
  const urls = post.image_urls && post.image_urls.length > 0 ? post.image_urls : [post.image_url];

  try {
    const postId = await publishToInstagram({
      igUserId: creds.ig_user_id,
      accessToken: creds.access_token,
      imageUrls: urls,
      caption: post.caption,
    });
    await supabaseAdmin.from("scheduled_posts").update({ status: "posted", post_id: postId }).eq("id", post.id);
    res.status(200).json({ processed: 1, result: { id: post.id, status: "posted", postId, images: urls.length } });
  } catch (err) {
    await supabaseAdmin.from("scheduled_posts").update({ status: "failed", error: err.message }).eq("id", post.id);
    res.status(200).json({ processed: 1, result: { id: post.id, status: "failed", error: err.message } });
  }
}
