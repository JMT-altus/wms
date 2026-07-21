# Deploy JMT WMS to Vercel

One-time setup to put the app live on Vercel. ~20 minutes.

## 0. Prerequisites (already done)
- Supabase project migrated (empty JMT schema) ✅
- Firebase project `jmtwms-dc401` with Email/Password enabled ✅
- Both admins bootstrapped ✅
- A filled-in `.env.local` (you'll copy these values into Vercel) ✅

---

## 1. Put the code in a Git repo
Vercel deploys from GitHub/GitLab/Bitbucket. From `d:\JMT\JMT WMS`:

```bash
git init
git add .
git commit -m "JMT WMS initial"
```

`.gitignore` already excludes `.env.local` and the Firebase service-account JSON, so **no secrets get committed** — verify with `git status` that neither appears.

Create a **private** repo on GitHub (e.g. `jmt-wms`) and push:

```bash
git remote add origin https://github.com/<you>/jmt-wms.git
git branch -M main
git push -u origin main
```

> No GitHub? Alternative: install the CLI (`npm i -g vercel`), run `vercel` in the
> folder, and it deploys directly — then add env vars in step 3 and redeploy.

## 2. Import into Vercel
1. https://vercel.com → **Add New → Project** → import your `jmt-wms` repo.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`,
   install `pnpm install` — both auto. **Don't deploy yet** — add env vars first (step 3),
   or the first build's `NEXT_PUBLIC_*` values will be blank.

## 3. Add environment variables
Vercel → your project → **Settings → Environment Variables**. Add every key from
`.env.local` for the **Production** (and Preview) environment. Copy the values
exactly, **without** the surrounding quotes shown in `.env.local`:

| Key | Notes |
|---|---|
| `DATABASE_URL` | **Use the Supabase _pooler_ string** (Settings → Database → Connection string → *Session pooler*), not the direct one — Vercel's serverless functions need the pooler. Keep the `%40`-encoded password. |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `sb_publishable_…` key |
| `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `jmtwms-dc401.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `jmtwms-dc401` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | |
| `FIREBASE_PROJECT_ID` | `jmtwms-dc401` |
| `FIREBASE_CLIENT_EMAIL` | |
| `FIREBASE_PRIVATE_KEY` | **Gotcha:** paste the value with the literal `\n` sequences, and **do not** include the outer double-quotes. The app converts `\n` → real newlines. |
| `COOKIE_SECRET_CURRENT` | |
| `COOKIE_SECRET_PREVIOUS` | |
| `RESEND_API_KEY` | (add when you have it; without it, invite emails just don't send) |
| `RESEND_FROM_EMAIL` | `JMT Drive Solutions <noreply@jmtdrives.com>` once the domain is verified |
| `CRON_SECRET` | enables Vercel Cron auth for the digest/backup jobs |
| `NEXT_PUBLIC_SITE_URL` | **Set to your production URL** (e.g. `https://jmt-wms.vercel.app` or `https://wms.jmtdrives.com`). Used in email links, redirects, PDF footers. |

Optional (leave unset to disable): `SLACK_BOT_TOKEN`, `META_WHATSAPP_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, Sentry keys.

## 4. Deploy
Click **Deploy**. The first build takes a few minutes. If it fails, open the build
log — it's almost always a missing/misformatted env var (usually `FIREBASE_PRIVATE_KEY`).

## 5. Point Firebase + Supabase at the live domain
1. **Firebase Console → Authentication → Settings → Authorized domains → Add**
   your Vercel domain (`jmt-wms.vercel.app` and/or `wms.jmtdrives.com`). **Login
   will fail from the deployed site until you do this.**
2. **Supabase → Authentication → Third-Party Auth → Firebase** → project ID
   `jmtwms-dc401` (needed for row-level security once real data exists).

## 6. Custom domain (optional)
Vercel → **Settings → Domains → Add** `wms.jmtdrives.com`, follow the DNS
instructions at your registrar. Then update `NEXT_PUBLIC_SITE_URL` to that domain
and add it to Firebase authorized domains (step 5).

## 7. Firebase Cloud Function (separate from Vercel)
The `functions/` folder (sets each new user's auth claim) deploys to Firebase, not
Vercel — needed before you can **invite** employees:

```bash
pnpm dlx firebase login
pnpm dlx firebase deploy --only functions
```
Requires the Firebase **Blaze** (pay-as-you-go) plan.

---

## Notes
- **Migrations don't run on Vercel.** Your schema is already applied to Supabase.
  For future schema changes, run `pnpm db:migrate` locally against the prod DB.
- **Cron jobs** (`vercel.json`) register automatically. The Vercel **Hobby** plan
  limits cron frequency; the daily digest/backup work, but the sub-daily ones need
  the **Pro** plan. The app runs fine without them.
- **Redeploys**: every `git push` to `main` auto-deploys. Env-var changes require a
  redeploy to take effect.
