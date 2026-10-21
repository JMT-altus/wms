import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Safety guard for integration tests that connect to a real Postgres through
 * DATABASE_URL_TEST. A test database must be demonstrably isolated:
 *
 *   - its host is local (localhost / 127.0.0.1 / ::1) or its database name
 *     contains "test"; and
 *   - it is NOT the database configured in .env.local (which may be production).
 *
 * The URLs are compared by hash and never printed. Returns null when the URL is
 * acceptable, otherwise the reason it was refused.
 */
export function refuseUnlessIsolated(url: string | undefined): string | null {
  if (!url) return "DATABASE_URL_TEST is not set.";
  let host = "";
  let name = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    name = u.pathname.replace(/^\//, "").toLowerCase();
  } catch {
    return "DATABASE_URL_TEST is not a valid URL.";
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!local && !name.includes("test")) {
    return "DATABASE_URL_TEST must point at a local database or one whose name contains 'test'.";
  }
  const envLocal = resolve(__dirname, "../../.env.local");
  if (existsSync(envLocal)) {
    const line = readFileSync(envLocal, "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    if (line) {
      const configured = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
      const hash = (s: string) => createHash("sha256").update(s).digest("hex");
      if (hash(configured) === hash(url.trim())) {
        return "DATABASE_URL_TEST is the same database as .env.local's DATABASE_URL; refusing to run tests against it.";
      }
    }
  }
  return null;
}
