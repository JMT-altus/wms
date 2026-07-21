# JMT Drive Solutions WMS — Setup Runbook

Step-by-step guide to stand up the JMT Drive Solutions work-management system on
its **own** Supabase + Firebase, fully isolated from Altus Corp. Follow top to
bottom. Every credential goes into `.env.local` (copy from `.env.local.example`).

> **Data isolation:** this app only ever reads from the Supabase/Firebase
> projects you configure below. As long as you create **new, empty** JMT
> projects (and never run the Altus seed script), no Altus Corp data can appear.

---

## 0. Prerequisites

- Node.js 22+ and `pnpm` (`npm i -g pnpm`)
- A Google account for Firebase (suggest `jmt.altus@gmail.com`)
- A Supabase account
- A Resend account + control of DNS for `jmtdrives.com` (for branded email)
- From the project root: `pnpm install`

---

## 1. Create the Supabase project (database)

1. https://supabase.com → **New project** → name it `jmt-wms`. Pick a region
   near your users (e.g. Mumbai `ap-south-1`). Save the database password.
2. **Project Settings → Database → Connection string → URI** (port 5432).
   Copy into `DATABASE_URL`.
3. **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)

## 2. Create the Firebase project (identity)

1. https://console.firebase.google.com → **Add project** → name it `jmt-wms`.
2. **Build → Authentication → Get started → Sign-in method → Email/Password →
   Enable.** (Leave "Email link" off. There is no public sign-up in this app.)
3. **Project settings (gear) → General → Your apps → Web app (`</>`)** → register
   an app called "JMT WMS". Copy the SDK config values:
   - `apiKey` → `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `authDomain` → `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (e.g. `jmt-wms.firebaseapp.com`)
   - `projectId` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID` **and** `FIREBASE_PROJECT_ID`
   - `appId` → `NEXT_PUBLIC_FIREBASE_APP_ID`
4. **Project settings → Service accounts → Generate new private key.** A JSON file
   downloads. From it:
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (paste as one line, keep the `\n`
     sequences, wrap in double quotes)
5. Update `.firebaserc` → `"default": "jmt-wms"` (already set to `jmt-wms`; change
   if you named the project differently).

## 3. Wire Firebase as Supabase Third-Party Auth (so RLS trusts Firebase)

1. Supabase → **Authentication → Sign In / Providers → Third-Party Auth → Add
   provider → Firebase.** Enter your Firebase `projectId` (`jmt-wms`).
2. This lets Supabase RLS policies evaluate `auth.jwt() ->> 'sub'` against
   Firebase UIDs. (Migrations in `db/migrations` create the RLS policies.)

## 4. Resend (email for invites & password resets)

1. https://resend.com → **API Keys → Create** → copy into `RESEND_API_KEY`.
2. **Domains → Add** `jmtdrives.com` and add the shown DNS records (SPF/DKIM) at
   your registrar. Wait for "Verified".
3. Set `RESEND_FROM_EMAIL="JMT Drive Solutions <noreply@jmtdrives.com>"`.
   (Until the domain verifies you may use `onboarding@resend.dev` for testing.)

## 5. Fill in secrets & verify

```bash
cp .env.local.example .env.local
# edit .env.local with all values from steps 1–4
# generate the two cookie secrets and the cron secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # x2 for COOKIE_SECRET_*
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"   # CRON_SECRET

pnpm verify:env        # must print all ✓ before continuing
```

## 6. Apply the database schema (creates empty JMT tables)

```bash
pnpm db:migrate        # applies db/migrations to your Supabase — NO data, empty tables
```

> Do **NOT** run `pnpm seed` / `pnpm seed:firebase` — those load Altus sample
> data. JMT must start empty.

## 7. Deploy the auth-claim Cloud Function

The `functions/` folder sets each new user's auth claim. Deploy it to `jmt-wms`:

```bash
pnpm dlx firebase login
pnpm dlx firebase deploy --only functions
```

## 8. Bootstrap the two JMT admins

Once (per environment) — creates the first admins so invite-only signup can begin:

```bash
cp .env.local .env.bootstrap        # add SUPABASE_SERVICE_ROLE_KEY if missing
pnpm bootstrap-admin --email mihir.jmtds@gmail.com --name "Mihir Veera"
pnpm bootstrap-admin --email jmt.altus@gmail.com  --name "JMT"
rm .env.bootstrap                   # delete immediately — contains service-role key
```

Each admin gets a password-reset email (or the link is printed to stdout). They
set a password on `/set-password`, then land on `/welcome`.

> `mihir.jmtds@gmail.com` and `jmt.altus@gmail.com` are also hard-listed as
> **super-admins** in `lib/auth/super-admin.ts` (the only accounts allowed to
> promote/demote other admins).

## 9. Run it

```bash
pnpm dev               # http://localhost:3000  → sign in as an admin
```

From `/admin/employees`, invite the rest of the JMT team. From `/admin/settings`
set the company name, working days, timezone, office geofence, and (optionally)
upload a logo to override the bundled one.

---

## Production deploy (Vercel)

1. Import the repo in Vercel. Framework: Next.js.
2. Add every non-optional var from `.env.local` to **Project → Settings →
   Environment Variables** (Production + Preview).
3. Set `NEXT_PUBLIC_SITE_URL` to your real URL (e.g. `https://wms.jmtdrives.com`)
   and add that domain in Vercel → Domains.
4. Add the same domain to Firebase → Authentication → Settings → **Authorized
   domains**.
5. Redeploy. Run steps 6 & 8 against the production project once.

## What is JMT-specific vs. still needs your input

- ✅ Branding, colours (teal), logo, company name, admin accounts, data
  isolation — all done.
- ⚠️ **Incentive & salary modules** carry Altus's program structure (workshop
  lists, incentive categories, payslip fields). Provide JMT's real definitions
  (this is likely what the Google Sheet holds) and we'll replace them.
- ⚠️ **Logo/icon quality** — the current logo is low-resolution and reused for
  the PWA icons. Provide a high-res transparent PNG/SVG + a square icon for
  crisp tabs/app icons.
