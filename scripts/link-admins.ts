/**
 * Link already-existing Firebase Auth users to admin `employees` rows.
 *
 * Use this instead of bootstrap-admin when the Firebase users were created
 * manually in the console (bootstrap-admin tries to *create* them and fails
 * with email-already-exists). For each admin it:
 *   1. looks up the Firebase user by email,
 *   2. sets the custom claim { role: "authenticated" } (needed for Supabase RLS),
 *   3. upserts an active admin `employees` row carrying that firebase_uid.
 *
 * Usage: tsx --env-file=.env.local scripts/link-admins.ts
 */
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { employees } from "../db/schema";
import { normalizeName } from "../lib/validators/employee";

const ADMINS = [
  { email: "mihir.jmtds@gmail.com", name: "Mihir Veera" },
  { email: "jmt.altus@gmail.com", name: "JMT" },
];

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  const auth = getAuth();

  for (const { email, name } of ADMINS) {
    const lc = email.toLowerCase().trim();
    let uid: string;
    try {
      const u = await auth.getUserByEmail(lc);
      uid = u.uid;
    } catch (e) {
      console.error(`✗ ${lc}: no Firebase user found — add them in the console first. (${(e as Error).message})`);
      continue;
    }

    // 1. Custom claim for RLS.
    await auth.setCustomUserClaims(uid, { role: "authenticated" });

    // 2. Upsert the employees row.
    const existing = await db.query.employees.findFirst({ where: eq(employees.email, lc) });
    if (existing) {
      await db.update(employees)
        .set({ firebaseUid: uid, isAdmin: true, isActive: true })
        .where(eq(employees.id, existing.id));
      console.log(`✓ ${lc}: updated employees row (id=${existing.id}) → uid ${uid}, admin, active`);
    } else {
      const [row] = await db.insert(employees).values({
        name: normalizeName(name),
        email: lc,
        role: "both",
        isAdmin: true,
        isActive: true,
        firebaseUid: uid,
        invitedAt: new Date(),
      }).returning();
      console.log(`✓ ${lc}: created employees row (id=${row?.id}) → uid ${uid}, admin, active`);
    }
  }

  console.log("\nDone. Both admins can now sign in with the password you set in Firebase.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
