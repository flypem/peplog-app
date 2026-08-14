# Flyptide — Setup, Deploy & Launch Guide

This turns the prototype into a real, live, paying product. Follow every
step in order — nothing is optional unless marked "(optional)."

You'll need: a computer with Node.js installed, a credit card (for Stripe,
even in test mode setup), and about 2–3 hours the first time through.

---

## 📌 If you already have this live under the old name (PepLog)

You don't need to redo Parts 1–6 — everything you already set up (Supabase,
Stripe test mode, Vercel deployment) keeps working exactly as-is. Renaming
is just:

1. **Copy these files into your existing project**, overwriting the old
   ones: `src/App.jsx`, `src/Auth.jsx`, `index.html`, `public/manifest.json`,
   `package.json`, `README.md`, `legal/*.md`, `public/terms.html`,
   `public/privacy.html`.
2. **Redeploy:**
   ```
   git add .
   git commit -m "Rename to Flyptide"
   git push
   vercel --prod
   ```
3. **Heads up on app data:** the storage keys changed from `peplog:*` to
   `flyptide:*`, so any test vials/log entries you already created will
   stop showing up (the old data isn't deleted, just orphaned under the
   old key names — harmless to ignore since it's test data anyway).
4. **Connect your new domain** (`flyptide.app`) — see Part 8 below. Once
   connected, update the Stripe webhook URL (5.4) and Supabase Site URL
   (5.3) to point at the new domain instead of the old `.vercel.app` one.
5. **Cosmetic, optional:** your Vercel project and GitHub repo can stay
   named "peplog-app" internally forever — nobody but you ever sees that.
   Rename them only if it'll bother you, not because it's required.
6. **Update your Stripe product's display name** — Stripe dashboard →
   Product catalog → your product → rename "PepLog Pro" to "Flyptide Pro."
   Purely cosmetic (customers see this on the Checkout page and their
   card statement won't necessarily reflect it), but worth tidying up.

---

## Part 1 — Get the code running on your computer

### 1.1 Install Node.js
If you don't already have it: go to https://nodejs.org, download the
"LTS" version, install it. Confirm it worked:

```bash
node --version
```

You should see something like `v20.x.x`. Any 18+ is fine.

### 1.2 Unzip the project and install dependencies
Unzip the file I gave you, then in a terminal:

```bash
cd flyptide-app
npm install
```

This downloads all the libraries (React, Supabase client, Stripe, etc.)
into a `node_modules` folder. Takes 1–2 minutes.

---

## Part 2 — Set up Supabase (your database + login system)

### 2.1 Create an account and project
1. Go to https://supabase.com → **Start your project** → sign up (free).
2. Click **New Project**.
3. Name it `flyptide`, set a database password (save it somewhere — a
   password manager, not a sticky note), pick the region closest to your
   users, click **Create new project**. Takes ~2 minutes to provision.

### 2.2 Run the database schema
1. In your new project, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/schema.sql` from this project, copy the whole thing,
   paste it in, click **Run**.
4. You should see "Success. No rows returned." That means two tables
   (`kv_store` and `profiles`) now exist with the right security rules.

### 2.3 Turn on email sign-in
1. Left sidebar → **Authentication** → **Providers**.
2. Confirm **Email** is enabled (it is by default).
3. Authentication → **URL Configuration** → set **Site URL** to
   `http://localhost:5173` for now (you'll change this to your real
   domain in Part 5).

### 2.4 Get your API keys
1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. You'll see three things you need:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — long string starting with `eyJ...`
   - **service_role key** — another long string, also starting with `eyJ...`
     — **this one is secret**, never put it in frontend code or commit it
     to a public repo. It bypasses all security rules.

Keep this tab open — you'll paste these into `.env` in Part 4.

---

## Part 3 — Set up Stripe (payments)

### 3.1 Create an account
Go to https://dashboard.stripe.com/register and sign up. You can do
everything below in **Test mode** first (toggle in the top-right of the
dashboard) and switch to live mode later without redoing any code.

### 3.2 Create your product and price
1. Left sidebar → **Product catalog** → **Add product**.
2. Name: `Flyptide Pro`.
3. Pricing: **Recurring**, `$6.00`, billing period **Monthly** (or
   whatever you land on after reading Part 7 below).
4. Save. Click into the product, find the **Price ID** — looks like
   `price_1AbCdEfGhIjKlMn`. Copy it.

### 3.3 Get your API keys
1. Left sidebar → **Developers** → **API keys**.
2. Copy the **Secret key** (starts with `sk_test_...` in test mode).
   Never expose this in frontend code.

### 3.4 Set up the webhook (do this after Part 5 deploy — see note)
Skip this for now — webhooks need a real URL to point to, which you won't
have until your app is deployed (Part 5). I'll bring you back here.

---

## Part 4 — Configure your environment variables

1. In the project folder, copy the example file:

```bash
cp .env.example .env
```

2. Open `.env` in any text editor and fill in the values you collected:

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...  (the anon/public key)

SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  (the service_role key)

STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...   (leave as-is for now, you'll get this in Part 5.4)
```

3. Save. This file is already in `.gitignore` so it won't accidentally
   get committed to GitHub.

### 4.1 Run it locally
```bash
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`). You should see
the Flyptide sign-in screen. Enter your own email, check your inbox for the
magic link, click it — you should land back in the app, signed in.

Test the calculator and inventory features now — they should work exactly
like the version you tested in chat, just backed by a real database this
time. Stripe checkout won't work yet (no webhook configured) — that's
next.

---

## Part 5 — Deploy to Vercel (put it on the internet)

### 5.1 Push the code to GitHub
1. Go to https://github.com/new, create a repo (private is fine for now).
2. In your project folder:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/flyptide-app.git
git push -u origin main
```

### 5.2 Import into Vercel
1. Go to https://vercel.com → sign up with your GitHub account.
2. **Add New** → **Project** → select your `flyptide-app` repo → **Import**.
3. Framework preset should auto-detect **Vite**. Leave build settings as
   default.
4. Before deploying, click **Environment Variables** and add every value
   from your `.env` file (same names, same values). Do this now so the
   first deploy succeeds.
5. Click **Deploy**. Takes ~1 minute. You'll get a URL matching your
   Vercel project's name, like `https://flyptide-app.vercel.app` (or
   whatever you named the project).

### 5.3 Update Supabase's allowed URL
Back in Supabase → Authentication → URL Configuration → change **Site
URL** to your real Vercel URL (or custom domain once you have one — see
Part 8). Otherwise magic-link emails will redirect to localhost.

### 5.4 Now set up the Stripe webhook (the piece we skipped)
1. Stripe dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://YOUR-ACTUAL-DEPLOYED-URL/api/stripe-webhook`
   (use your real deployed URL — check your Vercel project's dashboard for
   the exact domain, whether that's a `.vercel.app` URL or your connected
   custom domain).
3. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Click **Add endpoint**. Click into it, find **Signing secret** (starts
   with `whsec_...`), copy it.
5. Go back to Vercel → your project → **Settings** → **Environment
   Variables** → update `STRIPE_WEBHOOK_SECRET` with this value.
6. Vercel → **Deployments** → click the latest one → **Redeploy** (so the
   new env var takes effect).

---

## Part 6 — Test the whole flow end-to-end

Still in Stripe **test mode**:

1. Visit your live URL, sign in with your email.
2. Go to Account tab → **Upgrade**. You'll land on a real Stripe Checkout
   page.
3. Use Stripe's test card: `4242 4242 4242 4242`, any future expiry, any
   3-digit CVC, any ZIP.
4. Complete checkout. You should be redirected back to the app, and
   within a few seconds the plan badge should flip to **PRO** (the app
   polls for the webhook to land).
5. Go to Stripe dashboard → Payments — you should see the test payment.
   Supabase → Table Editor → `profiles` — you should see your row with
   `plan = 'pro'` and a `stripe_customer_id` filled in.
6. Test **Manage billing** from the Account tab — it should open the real
   Stripe customer portal where you can cancel. Cancel it, confirm the
   webhook flips you back to `free` within a minute.

If any of this doesn't work, see **Troubleshooting** at the bottom before
moving on.

### 6.1 Go live
Once everything above works in test mode:
1. Stripe dashboard → toggle out of **Test mode** (top right).
2. Recreate your product/price in live mode (test and live are separate —
   yes, you have to redo the product creation once for real).
3. Get your **live** secret key and **live** webhook signing secret
   (repeat 3.3 and 5.4 in live mode).
4. Update the Vercel environment variables with the live values.
5. Redeploy.

---

## Part 7 — Pricing (researched for you)

Real competitor pricing as of mid-2026:

| App | Price |
|---|---|
| PeptidePal | $2.99/mo flat |
| Regimen | Free tier + $4.99/mo or $39.99/yr |
| PeptIQ | Free (1 item) + $9.99/mo or $69.99/yr |
| Peptide Tracker & Calculator | Free + IAP, monthly/annual, 3-day trial |

**$6/mo lands in the middle** — reasonable. Two things worth doing before
you lock it in:
- Add an **annual option** at a discount (e.g. $48/yr, a ~33% discount vs.
  paying monthly) — every competitor above offers one, and it meaningfully
  reduces churn since people don't re-decide every 30 days. This requires
  creating a second Stripe Price and adding a toggle in the UI — ask me if
  you want this built.
- Consider a short free trial (3–7 days) on your paid plan rather than a
  permanently-free single-item tier, if you want to match how PeptIQ/
  Regimen frame it — this is a Stripe Checkout setting (`subscription_data.trial_period_days`), not a big code change.

---

## Part 8 — Custom domain (you've got one picked out: flyptide.app)

1. **Register it** — `flyptide.app` was available at last check. Use
   Porkbun or Cloudflare Registrar (see the pricing research earlier in
   this project) — roughly $15–20/yr for a `.app` domain.
2. **Connect it to Vercel** — your project → **Settings** → **Domains** →
   add `flyptide.app` → follow the DNS records Vercel shows you (usually
   just adding an A record or changing nameservers at your registrar).
   DNS propagation can take anywhere from a few minutes to a few hours.
3. **Update Supabase's Site URL** (see 2.3 above) to `https://flyptide.app`.
4. **Update the Stripe webhook endpoint** (see 5.4 above) to
   `https://flyptide.app/api/stripe-webhook` — you'll need a fresh
   signing secret for this, since it's technically a new endpoint URL.
5. Once confirmed working on the new domain, the `.vercel.app` URL still
   works too (Vercel keeps both live) — that's fine, no need to disable it.

---

## Part 9 — Distribution: web app vs. app stores

**Start as an installable web app (what you already have).** On iPhone:
Safari → Share → "Add to Home Screen." On Android: Chrome shows an
"Install app" prompt automatically. No app review, no 30% platform fee,
ships the moment you deploy.

**App Store / Play Store later, if at all.** Apple and Google have been
inconsistent and often strict about apps touching unregulated peptides,
even purely for tracking — rejection or required changes are a real
possibility. I'd validate demand on the web first, then revisit. If you
do go this route later, ask me to research current App Store/Play Store
policy specifics before you submit — policies shift.

---

## Part 10 — Legal (do this before telling anyone it's live)

1. Have a lawyer review `legal/privacy-policy.md` and
   `legal/terms-of-service.md` — fill in the bracketed placeholders
   (`[DATE]`, your email, your state/country, your actual refund policy).
2. Copy the finalized text into `public/terms.html` and
   `public/privacy.html` (these are what's actually live at
   `yourdomain.com/terms` and `/privacy`).
3. Redeploy.

---

## Part 11 — Launch checklist

- [ ] Supabase schema run, RLS confirmed (try editing another user's data
      from devtools — it should fail)
- [ ] Stripe live mode keys in place, webhook receiving events
- [ ] Full signup → subscribe → cancel flow tested with a real (small)
      charge, not just test cards
- [ ] Legal pages finalized and live
- [ ] Custom domain connected (optional)
- [ ] App icons replaced (the ones in `public/` right now are plain
      placeholders — swap `icon-192.png` and `icon-512.png` for a real
      logo before sharing publicly)
- [ ] Post in 2–3 peptide/biohacking communities as a person sharing a
      useful tool, not a launch announcement — same playbook as your
      True Cost outreach

---

## Troubleshooting

**Magic link email never arrives** — Supabase's default email sender is
rate-limited and sometimes lands in spam. Check spam first; for real
volume later, connect your own SMTP under Authentication → Email
Templates.

**"Not signed in" errors on checkout** — the browser session may have
expired; sign out and back in.

**Plan doesn't flip to Pro after paying** — check Vercel → your project →
**Logs** for the `stripe-webhook` function to see if Stripe is reaching
it and what error (if any) it's throwing. Most common cause: the webhook
signing secret in Vercel env vars doesn't match the one Stripe shows for
that specific endpoint.

**"relation kv_store does not exist"** — the schema.sql didn't run;
repeat 2.2.

**CORS or 401 errors calling /api/...** — confirm you redeployed after
adding environment variables; Vercel doesn't hot-reload env vars into
already-running deployments.
