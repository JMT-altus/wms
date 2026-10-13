import { redirect } from "next/navigation";
import type { Route } from "next";

export const dynamic = "force-dynamic";

/**
 * Policies moved under the HR module, to /hr/policies.
 *
 * This route stays so every old link, bookmark and emailed URL keeps working.
 * It is still guarded: the module-access check in app/(app)/layout.tsx runs
 * BEFORE this page, and `/salary/policy` now resolves to the HR module (see
 * `routes` in lib/nav-modules.ts), so the redirect is only reachable by someone
 * who is allowed into HR — the redirect hands out no access of its own.
 */
export default function LegacySalaryPolicyRedirect(): never {
  redirect("/hr/policies" as Route);
}
