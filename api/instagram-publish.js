import { getInstagramCredentials } from "./_ig_lib.js";
import { publishToInstagram } from "./_ig_publish.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-publish-secret"];
  if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { imageUrl, imageUrls, caption } = req.body || {};
  const urls = Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : null;
  if (!urls) return res.status(400).json({ error: "imageUrl or imageUrls is required" });

  const creds = await getInstagramCredentials();
  if (!creds || !creds.access_token) {
    return res.status(400).json({ error: "Instagram isn't connected yet." });
  }

  try {
    const postId = await publishToInstagram({
      igUserId: creds.ig_user_id,
      accessToken: creds.access_token,
      imageUrls: urls,
      caption,
    });
    res.status(200).json({ success: true, postId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
