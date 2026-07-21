// End-to-end smoke test: authenticate as an admin (custom token → ID token →
// session cookie), then crawl every route and report status + error markers.
// Run: tsx --env-file=.env.local scripts/smoke.ts
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const BASE = "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL || "jmt.altus@gmail.com";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;

const ROUTES = process.env.SMOKE_ROUTES ? process.env.SMOKE_ROUTES.split(",") : [
  // Hub
  "/hub",
  // WMS module
  "/", "/tasks/agenda", "/tasks", "/tasks/kanban", "/projects", "/weekly-goals",
  "/weekly-goals/dashboard", "/tasks/import", "/tasks/duplicates", "/tasks/new",
  // Employees module
  "/attendance", "/attendance/dashboard", "/attendance/leave", "/salary",
  "/salary/policy", "/incentive", "/incentive/dashboard", "/reimbursements", "/leave-approval",
  // Sales module
  "/outstanding", "/outstanding/contracts", "/record-reference", "/participant-breakthrough",
  // Training module
  "/training",
  // Shared / utility
  "/profile", "/inbox", "/documents", "/archived", "/index", "/search",
  // Admin
  "/admin", "/admin/employees", "/admin/settings", "/admin/clients", "/admin/departments",
];

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID!;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const auth = getAuth();

  const user = await auth.getUserByEmail(EMAIL);
  const customToken = await auth.createCustomToken(user.uid, { role: "authenticated" });

  const r1 = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const j1: any = await r1.json();
  if (!j1.idToken) throw new Error("custom-token exchange failed: " + JSON.stringify(j1));

  const r2 = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: j1.idToken }),
    redirect: "manual",
  });
  const setCookies = (r2.headers as any).getSetCookie?.() ?? [];
  const cookieHeader = setCookies.map((c: string) => c.split(";")[0]).join("; ");
  console.log(`\nsession endpoint: ${r2.status} · cookies: ${cookieHeader ? "received" : "NONE"}`);
  if (!cookieHeader) { console.log(await r2.text()); throw new Error("no session cookie — cannot crawl"); }

  const MARKERS = ["Application error", "client-side exception", "we hit a snag", "Something went wrong",
    "Internal Server Error", "This page could not be found", "TypeError:", "ReferenceError:"];

  const bad: string[] = [];
  console.log("\n=== crawling " + ROUTES.length + " routes ===");
  for (const route of ROUTES) {
    const t0 = Date.now();
    let line = "";
    try {
      const res = await fetch(`${BASE}${route}`, { headers: { Cookie: cookieHeader }, redirect: "manual" });
      const ms = Date.now() - t0;
      let note = "";
      if (res.status >= 300 && res.status < 400) {
        note = "→ " + res.headers.get("location");
      } else {
        const body = await res.text();
        const hits = MARKERS.filter((m) => body.includes(m));
        if (hits.length) note = "ERR: " + hits.join(", ");
      }
      const ok = res.status === 200 && !note;
      line = `${ok ? "✓" : "✗"} ${String(res.status).padEnd(3)} ${route.padEnd(30)} ${ms}ms ${note}`;
      if (!ok) bad.push(`${res.status} ${route} ${note}`);
    } catch (e) {
      line = `✗ ERR ${route} — ${e}`;
      bad.push(`${route} — ${e}`);
    }
    console.log(line);
  }

  console.log(`\n=== RESULT: ${ROUTES.length - bad.length}/${ROUTES.length} clean ===`);
  if (bad.length) { console.log("Issues:"); bad.forEach((b) => console.log("  " + b)); }
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
