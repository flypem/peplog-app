import { supabaseAdmin } from "./_ig_lib.js";

function page(title, message, color) {
  return `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:400px;margin:80px auto;text-align:center;color:#1C2B33;">
    <h2 style="color:${color}">${title}</h2><p>${message}</p></body></html>`;
}

export default async function handler(req, res) {
  // POST — direct single/carousel scheduling (used by the "Approve &
  // Schedule" button on post.html, already-approved-by-a-human, so it goes
  // straight to "pending" rather than "draft").
  if (req.method === "POST") {
    const secret = req.headers["x-publish-secret"];
    if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { imageUrl, imageUrls, caption, scheduledFor } = req.body || {};
    const urls = Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : null;
    if (!urls || !scheduledFor) {
      return res.status(400).json({ error: "imageUrl(s) and scheduledFor are required" });
    }
    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .insert({ image_urls: urls, caption: caption || "", scheduled_for: scheduledFor, status: "pending" })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ success: true, id: data.id, scheduledFor: data.scheduled_for });
  }

  // GET — list drafts (no id), or approve/reject a specific one (id + action).
  const { secret, id, action } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!id) {
    const { data, error } = await supabaseAdmin
      .from("scheduled_posts")
      .select("*")
      .eq("status", "draft")
      .order("scheduled_for", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ drafts: data });
  }

  if (action !== "approve" && action !== "reject") {
    return res.status(400).send(page("Invalid action", "Use ?action=approve or ?action=reject.", "#C0392B"));
  }

  const newStatus = action === "approve" ? "pending" : "rejected";
  const { data, error } = await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .maybeSingle();

  if (error) return res.status(500).send(page("Error", error.message, "#C0392B"));
  if (!data) return res.status(200).send(page("Already handled", "This post was already approved, rejected, or posted.", "#8A9299"));

  if (action === "approve") {
    return res.status(200).send(page("✅ Approved", `Will publish automatically at ${new Date(data.scheduled_for).toLocaleString()}.`, "#127D77"));
  }
  return res.status(200).send(page("Rejected", "This post will not be published.", "#8A9299"));
}
