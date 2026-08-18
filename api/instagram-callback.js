// TEMPORARY DEBUG VERSION — shows exactly what we send and what Instagram
// sends back, in full, instead of a generic error. Never logs the secret.
export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Authorization failed: ${error_description || error}`);
  }
  if (!code) return res.status(400).send("Missing authorization code");

  const sentParams = {
    client_id: process.env.INSTAGRAM_APP_ID,
    client_secret: "(hidden, length: " + (process.env.INSTAGRAM_APP_SECRET || "").length + ")",
    grant_type: "authorization_code",
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    code: code,
  };

  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    client_secret: process.env.INSTAGRAM_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    code,
  });

  let shortData, shortStatus;
  try {
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: form,
    });
    shortStatus = shortRes.status;
    shortData = await shortRes.json();
  } catch (err) {
    shortData = { fetchError: err.message };
  }

  res.setHeader("Content-Type", "text/plain");
  res.send(
    `=== What we sent to https://api.instagram.com/oauth/access_token ===\n` +
    JSON.stringify(sentParams, null, 2) +
    `\n\n=== Response status ===\n${shortStatus}\n` +
    `\n=== Response body ===\n` +
    JSON.stringify(shortData, null, 2) +
    `\n\n=== Raw code received from Instagram (check for unexpected characters/truncation) ===\n${code}\n`
  );
}
