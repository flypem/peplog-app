// Matches the exact URL Meta's own dashboard generates for this app
// (confirmed directly from the "Embed URL" field) — www.instagram.com,
// not api.instagram.com, with force_reauth and the full permission set.
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const params = new URLSearchParams({
    force_reauth: "true",
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    response_type: "code",
    scope: [
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ].join(","),
  });

  res.redirect(`https://www.instagram.com/oauth/authorize?${params.toString()}`);
}
