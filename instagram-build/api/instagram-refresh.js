import { getInstagramCredentials, saveInstagramCredentials } from "./_ig_lib.js";

export default async function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.INSTAGRAM_ADMIN_SECRET || secret !== process.env.INSTAGRAM_ADMIN_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const creds = await getInstagramCredentials();
  if (!creds || !creds.access_token) {
    return res.status(400).json({ error: "Not connected yet" });
  }

  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${creds.access_token}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) return res.status(400).json(data);

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await saveInstagramCredentials({ igUserId: creds.ig_user_id, accessToken: data.access_token, expiresAt });
  res.status(200).json({ refreshed: true, expiresAt });
}
