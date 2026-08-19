import { supabaseAdmin } from "./_ig_lib.js";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-publish-secret"];
  if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { imageBase64, filename } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required" });

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const path = `${Date.now()}-${(filename || "post.png").replace(/[^a-zA-Z0-9._-]/g, "")}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("social-posts")
      .upload(path, buffer, { contentType: "image/png", upsert: false });

    if (uploadError) return res.status(400).json({ error: uploadError.message });

    const { data } = supabaseAdmin.storage.from("social-posts").getPublicUrl(path);
    res.status(200).json({ url: data.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
