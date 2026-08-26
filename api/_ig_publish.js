const GRAPH = "https://graph.facebook.com/v21.0";

async function createContainer(igUserId, accessToken, params) {
  const res = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, access_token: accessToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Container creation failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function publishContainer(igUserId, accessToken, creationId) {
  const res = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Publish failed: ${JSON.stringify(data)}`);
  return data.id;
}

// Publishes either a single image or a carousel (2-10 images), based on how
// many image URLs are provided. Used by both api/instagram-publish.js
// (manual "publish now") and api/instagram-process-queue.js (the automatic
// background job) — one implementation, so they can never drift apart.
export async function publishToInstagram({ igUserId, accessToken, imageUrls, caption }) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  if (urls.length === 0 || !urls[0]) {
    throw new Error("At least one image URL is required");
  }
  if (urls.length > 10) {
    throw new Error("Instagram carousels support a maximum of 10 images");
  }

  if (urls.length === 1) {
    const containerId = await createContainer(igUserId, accessToken, {
      image_url: urls[0],
      caption: caption || "",
    });
    return publishContainer(igUserId, accessToken, containerId);
  }

  // Carousel: one child container per image (no caption on children), then
  // a parent container referencing all children (with the real caption).
  const childIds = [];
  for (const url of urls) {
    const childId = await createContainer(igUserId, accessToken, {
      image_url: url,
      is_carousel_item: true,
    });
    childIds.push(childId);
  }

  const parentId = await createContainer(igUserId, accessToken, {
    media_type: "CAROUSEL",
    children: childIds,
    caption: caption || "",
  });

  return publishContainer(igUserId, accessToken, parentId);
}
