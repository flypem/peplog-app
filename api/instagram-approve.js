import { supabaseAdmin } from "./_ig_lib.js";

function page(title, message, color) {
  return `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;max-width:400px;margin:80px auto;text-align:center;color:#1C2B33;">
    <h2 style="color:${color}">${title}</h2><p>${message}</p></body></html>`;
}

export default async function handler(req, res) {
  const { id, secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send(page("Forbidden", "Invalid or missing secret.", "#C0392B"));
  }
  if (!id) return res.status(400).send(page("Missing post ID", "", "#C0392B"));

  const { data, error } = await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "pending" })
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .maybeSingle();

  if (error) return res.status(500).send(page("Error", error.message, "#C0392B"));
  if (!data) return res.status(200).send(page("Already handled", "This post was already approved, rejected, or posted.", "#8A9299"));

  res.status(200).send(page("✅ Approved", `Will publish automatically at ${new Date(data.scheduled_for).toLocaleString()}.`, "#127D77"));
}
