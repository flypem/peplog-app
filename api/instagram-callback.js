import { saveInstagramCredentials } from "./_ig_lib.js";

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Authorization failed: ${error_description || error}`);
  }
  if (!code) return res.status(400).send("Missing authorization code");

  try {
    // Using FormData (multipart/form-data) instead of URLSearchParams
    // (application/x-www-form-urlencoded) — matches Meta's own curl -F
    // examples, which is a genuinely different encoding than -d/urlencoded.
    const form = new FormData();
    form.append("client_id", process.env.INSTAGRAM_APP_ID);
    form.append("client_secret", process.env.INSTAGRAM_APP_SECRET);
    form.append("grant_type", "authorization_code");
    form.append("redirect_uri", process.env.INSTAGRAM_REDIRECT_URI);
    form.append("code", code);

    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: form,
    });
    const shortData = await shortRes.json();
    if (!shortRes.ok) {
      return res.status(400).send(`<pre>Token exchange failed: ${JSON.stringify(shortData, null, 2)}</pre>`);
    }
    const { access_token: shortToken, user_id: igUserId } = shortData;

    const longUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${shortToken}`;
    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (!longRes.ok) {
      return res.status(400).send(`<pre>Long-lived token exchange failed: ${JSON.stringify(longData, null, 2)}</pre>`);
    }

    const expiresAt = new Date(Date.now() + longData.expires_in * 1000).toISOString();
    await saveInstagramCredentials({
      igUserId: String(igUserId),
      accessToken: longData.access_token,
      expiresAt,
    });

    res.send("✅ Instagram connected successfully. You can close this tab.");
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
}
