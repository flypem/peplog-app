import { saveInstagramCredentials } from "./_ig_lib.js";

const GRAPH = "https://graph.facebook.com/v21.0";

// Confirmed directly from the account-selection screen during authorization —
// this Configuration grants access to specific Instagram accounts directly,
// bypassing Facebook Pages entirely, so there's nothing to "discover" here.
const IG_BUSINESS_ACCOUNT_ID = "17841437042960736";

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

    // Step 3 — quick sanity check: confirm this token can actually see the
    // Instagram account directly (proves the credential works before saving it)
    const checkRes = await fetch(`${GRAPH}/${IG_BUSINESS_ACCOUNT_ID}?fields=username&access_token=${longData.access_token}`);
    const checkData = await checkRes.json();
    if (!checkRes.ok) {
      return res.status(400).send(`<pre>Token can't access the Instagram account: ${JSON.stringify(checkData, null, 2)}</pre>`);
    }

    await saveInstagramCredentials({
      igUserId: IG_BUSINESS_ACCOUNT_ID,
      accessToken: longData.access_token,
      expiresAt: null, // long-lived Facebook user tokens don't expire on a fixed schedule
    });

    res.send(`✅ Instagram connected successfully as @${checkData.username}. You can close this tab.`);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
}
