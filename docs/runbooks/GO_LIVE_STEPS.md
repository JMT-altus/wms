# JMT WMS — GitHub + Vercel, start to finish

Your code is already committed locally on branch `main` and the `origin` remote
points to `https://github.com/JMT-altus/wms.git`. Follow these in order.

═══════════════════════════════════════════════════════════════════
## PHASE 1 — Upload the code to GitHub
═══════════════════════════════════════════════════════════════════

### 1.1 Create an access token
1. Open **github.com**, signed in as **JMT-altus**.
2. Profile picture (top-right) → **Settings**.
3. Left sidebar, very bottom → **Developer settings**.
4. **Personal access tokens → Tokens (classic)**.
5. **Generate new token → Generate new token (classic)**.
6. Note: `jmt wms` · Expiration: **7 days** · Scopes: tick **`repo`**.
7. **Generate token** → **copy** it (looks like `ghp_XXXXXXXX`). Shown only once.

### 1.2 Push
In your terminal (already in `d:\JMT\JMT WMS`), run this — replacing `ghp_XXXX`
with the token you just copied (keep everything else exactly):

```bash
git push "https://JMT-altus:ghp_XXXX@github.com/JMT-altus/wms.git" main
```

Success looks like `* [new branch] main -> main`.

### 1.3 Verify + clean up
- Open **https://github.com/JMT-altus/wms** — the files should be there.
- Back in GitHub token settings, **delete** that token (not needed again).

═══════════════════════════════════════════════════════════════════
## PHASE 2 — Deploy to Vercel
═══════════════════════════════════════════════════════════════════

### 2.1 Import the repo
1. Go to **vercel.com** → sign in (use **Continue with GitHub**, as JMT-altus).
2. **Add New… → Project**.
3. Find **JMT-altus/wms** → **Import**. (If it's not listed, click *Adjust GitHub
   App Permissions* and grant Vercel access to the repo.)
4. Framework Preset shows **Next.js** automatically. Leave build settings as-is.
   **Do NOT click Deploy yet** — add the environment variables first (2.2).

### 2.2 Add environment variables
On the import screen, expand **Environment Variables**. Open your local
`d:\JMT\JMT WMS\.env.local` file and add each of these keys with the SAME value
(paste the value **without** the surrounding quotes from the file):

Required:
- `DATABASE_URL`  ← see the note below, use the **pooler** string
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`  ← paste WITH the `\n` sequences, WITHOUT the outer quotes
- `COOKIE_SECRET_CURRENT`
- `COOKIE_SECRET_PREVIOUS`
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`  ← set to `https://wms-<something>.vercel.app` for now;
  you'll finalise it after the first deploy gives you the real URL
- `RESEND_API_KEY`  ← add when you have it (emails just won't send without it)
- `RESEND_FROM_EMAIL`  ← e.g. `JMT Drive Solutions <onboarding@resend.dev>`

**Two gotchas:**
- **`DATABASE_URL`** — use the Supabase **Session pooler** string, NOT the direct
  `db.<ref>.supabase.co` one. Get it in Supabase → **Settings → Database →
  Connection string → Session pooler**. Keep the `%40` in the password. (Vercel's
  serverless functions need the pooler.)
- **`FIREBASE_PRIVATE_KEY`** — this is the long one. In `.env.local` it's wrapped in
  double-quotes with `\n` inside. In Vercel, paste the content **without** the
  outer quotes; keep the `\n` sequences. If the build later says "Invalid PEM",
  this is the culprit.

### 2.3 Deploy
Click **Deploy**. First build takes a few minutes. If it fails, open the build log
— it's almost always `FIREBASE_PRIVATE_KEY` formatting.

### 2.4 Finalise the site URL
1. After it deploys, Vercel shows your URL, e.g. `https://wms-xxxx.vercel.app`.
2. Vercel → project → **Settings → Environment Variables** → edit
   `NEXT_PUBLIC_SITE_URL` to that exact URL.
3. **Deployments** tab → latest → **⋯ → Redeploy** (so the new value takes effect).

═══════════════════════════════════════════════════════════════════
## PHASE 3 — Point Firebase + Supabase at the live URL (required for login)
═══════════════════════════════════════════════════════════════════

### 3.1 Firebase authorized domain (LOGIN FAILS WITHOUT THIS)
1. **Firebase Console** → project `jmtwms-dc401` → **Authentication → Settings**.
2. **Authorized domains → Add domain** → paste your Vercel domain
   (`wms-xxxx.vercel.app`). Save.

### 3.2 Supabase Third-Party Auth (for data security)
1. **Supabase** → your project → **Authentication → Sign In / Providers**.
2. **Third-Party Auth → Add provider → Firebase** → project ID `jmtwms-dc401` → Save.

### 3.3 Test it
Open your Vercel URL → you should reach the JMT login → sign in as
`jmt.altus@gmail.com` or `mihir.jmtds@gmail.com` → you land on the hub. 🎉

═══════════════════════════════════════════════════════════════════
## PHASE 4 — Optional (do anytime)
═══════════════════════════════════════════════════════════════════

- **Custom domain**: Vercel → Settings → Domains → add `wms.jmtdrives.com`, set the
  DNS records at your registrar, then update `NEXT_PUBLIC_SITE_URL` to it and add it
  to Firebase authorized domains (3.1) too.
- **Invite employees** requires the Firebase Cloud Function:
  `pnpm dlx firebase login && pnpm dlx firebase deploy --only functions`
  (needs the Firebase **Blaze** plan). The two bootstrapped admins work without it.
- **Emails**: verify `jmtdrives.com` in Resend, then set `RESEND_FROM_EMAIL` to
  `noreply@jmtdrives.com`.

═══════════════════════════════════════════════════════════════════
## After go-live
═══════════════════════════════════════════════════════════════════
Every `git push` to `main` auto-redeploys on Vercel. To push future changes with
the JMT-altus login, use the tokened URL form from 1.2 (or set up the GitHub CLI).
Env-var changes require a redeploy to take effect.
