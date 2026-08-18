// TEMPORARY DEBUG VERSION — shows the constructed URL as plain text instead
// of redirecting, so it can be read/copied directly without any browser
// dev-tools gymnastics. Swap back to the real redirect version once we've
// confirmed the values are correct.
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const appId = process.env.INSTAGRAM_APP_ID || "(missing)";
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || "(missing)";

  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: "instagram_business_basic,instagram_business_content_publish",
    response_type: "code",
  });
  const fullUrl = `https://api.instagram.com/oauth/authorize?${params.toString()}`;

  res.setHeader("Content-Type", "text/plain");
  res.send(
    `INSTAGRAM_APP_ID as seen by this deployment:\n${appId}\n\n` +
    `INSTAGRAM_REDIRECT_URI as seen by this deployment:\n${redirectUri}\n\n` +
    `Full constructed URL:\n${fullUrl}\n`
  );
}
