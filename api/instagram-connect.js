// Facebook Login for Business uses a pre-created "Configuration" (config_id)
// instead of a raw scope list — this is the modern, required approach for
// this specific login product (confirmed directly from Meta's own docs).
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const url =
    `https://www.facebook.com/v21.0/dialog/oauth?` +
    `client_id=${process.env.FACEBOOK_APP_ID}` +
    `&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}` +
    `&response_type=code` +
    `&config_id=${process.env.FACEBOOK_CONFIG_ID}`;

  res.redirect(url);
}
