import { getInstagramCredentials } from "./_ig_lib.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = req.headers["x-publish-secret"];
  if (!process.env.INSTAGRAM_PUBLISH_SECRET || secret !== process.env.INSTAGRAM_PUBLISH_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { imageUrl, caption } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  const creds = await getInstagramCredentials();
  if (!creds || !creds.access_token) {
    return res.status(400).json({ error: "Instagram isn't connected yet — run the connect step first." });
  }

  try {
    // Step 1 — create a media container
    const containerRes = await fetch(`${GRAPH}/${creds.ig_user_id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption || "",
        access_token: creds.access_token,
      }),
    });
    const containerData = await containerRes.json();
    if (!containerRes.ok) {
      return res.status(400).json({ error: "Container creation failed", details: containerData });
    }

    // Step 2 — publish the container
    const publishRes = await fetch(`${GRAPH}/${creds.ig_user_id}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: creds.access_token,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return res.status(400).json({ error: "Publish failed", details: publishData });
    }

    res.status(200).json({ success: true, postId: publishData.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
