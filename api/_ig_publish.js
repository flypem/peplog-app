const GRAPH = "https://graph.facebook.com/v21.0";

// Actually publishes to Instagram. Used by both api/instagram-publish.js
// (manual "publish now") and api/instagram-process-queue.js (the automatic
// background job) — one implementation, so they can never drift apart.
export async function publishToInstagram({ igUserId, accessToken, imageUrl, caption }) {
  const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption: caption || "", access_token: accessToken }),
  });
  const containerData = await containerRes.json();
  if (!containerRes.ok) {
    throw new Error(`Container creation failed: ${JSON.stringify(containerData)}`);
  }

  const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);
  }

  return publishData.id;
}
