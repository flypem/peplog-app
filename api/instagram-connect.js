// Builds the URL by hand rather than via URLSearchParams, to match
// character-for-character the exact "Embed URL" format shown in Meta's own
// App Dashboard (which does NOT percent-encode the redirect_uri value).
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const scope = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(",");

  const url =
    `https://www.instagram.com/oauth/authorize?force_reauth=true` +
    `&client_id=${process.env.INSTAGRAM_APP_ID}` +
    `&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}` +
    `&response_type=code` +
    `&scope=${scope}`;

  res.redirect(url);
}
