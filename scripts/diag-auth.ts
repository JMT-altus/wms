// Diagnose deployed login failure: reset the admin password to a known value,
// then test Firebase email/password sign-in via REST using the app's API key.
// This isolates whether the API key + credentials work (→ the Vercel build's
// NEXT_PUBLIC_FIREBASE_* env is the problem) or Firebase itself rejects.
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const EMAIL = "jmt.altus@gmail.com";
const NEWPASS = "JmtWms@2026";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const auth = getAuth();

  const u = await auth.getUserByEmail(EMAIL);
  await auth.updateUser(u.uid, { password: NEWPASS });
  console.log(`✓ Reset password for ${EMAIL} (uid ${u.uid}) to: ${NEWPASS}`);

  console.log(`\nTesting Firebase REST sign-in with API key ${API_KEY.slice(0, 10)}…`);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: NEWPASS, returnSecureToken: true }),
  });
  const j: any = await r.json();
  if (j.idToken) {
    console.log("✓ Firebase email/password sign-in WORKS with this API key.");
    console.log("  → The API key + credentials are valid. The deployed site's");
    console.log("    NEXT_PUBLIC_FIREBASE_API_KEY (or another NEXT_PUBLIC_FIREBASE_*)");
    console.log("    on Vercel is wrong/missing — re-check it and redeploy.");
  } else {
    console.log("✗ Firebase REST sign-in FAILED:", JSON.stringify(j.error ?? j));
    console.log("  → The API key itself is bad, or Email/Password is disabled.");
  }
  await auth.getUser(u.uid); // touch
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
