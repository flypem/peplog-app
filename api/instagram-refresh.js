import { getInstagramCredentials, saveInstagramCredentials } from "./_ig_lib.js";

const GRAPH = "https://graph.facebook.com/v21.0";

// Facebook long-lived user tokens last ~60 days and can be re-extended by
// calling the same fb_exchange_token grant again before they expire.
export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const creds = await getInstagramCredentials();
  if (!creds || !creds.access_token) {
    return res.status(400).json({ error: "Not connected yet" });
  }

  const url =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${process.env.FACEBOOK_APP_ID}` +
    `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
    `&fb_exchange_token=${creds.access_token}`;

  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) return res.status(400).json(data);

  await saveInstagramCredentials({
    igUserId: creds.ig_user_id,
    accessToken: data.access_token,
    expiresAt: null,
  });

  res.status(200).json({ refreshed: true });
}
