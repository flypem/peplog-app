import { saveInstagramCredentials } from "./_ig_lib.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Authorization failed: ${error_description || error}`);
  }
  if (!code) return res.status(400).send("Missing authorization code");

  try {
    // Step 1 — exchange code for a short-lived User access token
    const shortUrl =
      `${GRAPH}/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}` +
      `&redirect_uri=${process.env.INSTAGRAM_REDIRECT_URI}` +
      `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
      `&code=${code}`;
    const shortRes = await fetch(shortUrl);
    const shortData = await shortRes.json();
    if (!shortRes.ok) {
      return res.status(400).send(`<pre>Short-lived token exchange failed: ${JSON.stringify(shortData, null, 2)}</pre>`);
    }

    // Step 2 — exchange for a long-lived User access token (~60 days)
    const longUrl =
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${process.env.FACEBOOK_APP_ID}` +
      `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
      `&fb_exchange_token=${shortData.access_token}`;
    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (!longRes.ok) {
      return res.status(400).send(`<pre>Long-lived token exchange failed: ${JSON.stringify(longData, null, 2)}</pre>`);
    }

    // Step 3 — find the Facebook Page(s) this user manages
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${longData.access_token}`);
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok || !pagesData.data || pagesData.data.length === 0) {
      return res.status(400).send(`<pre>No Facebook Pages found: ${JSON.stringify(pagesData, null, 2)}</pre>`);
    }
    const page = pagesData.data[0]; // first Page — fine for a single-Page setup

    // Step 4 — find the Instagram Business Account linked to that Page
    const igRes = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
    const igData = await igRes.json();
    if (!igRes.ok || !igData.instagram_business_account) {
      return res.status(400).send(`<pre>No linked Instagram Business account found on Page "${page.name}": ${JSON.stringify(igData, null, 2)}</pre>`);
    }

    // Page access tokens derived from a long-lived User token don't expire
    // on their own (they last until the user revokes access), so no
    // separate expiry tracking is needed here the way the other flow needed.
    await saveInstagramCredentials({
      igUserId: igData.instagram_business_account.id,
      accessToken: page.access_token,
      expiresAt: null,
    });

    res.send(`✅ Instagram connected successfully via Page "${page.name}". You can close this tab.`);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
}
