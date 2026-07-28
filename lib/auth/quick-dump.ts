/**
 * Quick-dump allowlist. Only these accounts may brain-dump *unassigned* tasks
 * into the pool (they get the "Quick Dump" button on New Task; the server
 * action enforces it too). Everyone else uses the normal New Task form, which
 * always requires a doer.
 */
export const QUICK_DUMP_EMAILS = [
  "jmt.altus@gmail.com", // Altus Corp
  "mihir.jmtds@gmail.com", // Mihir Veera
] as const;

/** True if this signed-in email is allowed to quick-dump unassigned tasks. */
export function canQuickDump(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (QUICK_DUMP_EMAILS as readonly string[]).includes(normalized);
}
