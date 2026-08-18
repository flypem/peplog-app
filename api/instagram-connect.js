// One-time setup route: visit this URL (with the correct secret) to start
// the Instagram authorization flow. Not something you'd link to publicly —
// it's protected by INSTAGRAM_ADMIN_SECRET so random visitors can't trigger it.
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
  });

  res.redirect(`https://api.instagram.com/oauth/authorize?${params.toString()}`);
}
