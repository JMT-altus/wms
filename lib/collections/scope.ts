/**
 * Which Collection Master companies the signed-in person may see — the one
 * rule every Collection screen, query and server action applies.
 *
 *   all          a super-admin (lib/auth/super-admin.ts, the existing resolver):
 *                every company, assigned, unassigned or without a balance.
 *   coordinator  an ordinary login linked to a Sales Coordinator label through
 *                the super-admin-kept link (collection_coordinator_links →
 *                lib/collections/salesperson-identity.ts): only the companies
 *                whose Collection Master `coordinator_label` is that label.
 *   none         everyone else — no link yet, a login marked "not a Sales
 *                Coordinator", the link table not installed, or signed out:
 *                no company at all, and the screens say why.
 *
 * The employee always comes from the verified session (the resolver is
 * `collectionScopeFor` in lib/collections/scope-server.ts); nothing from the
 * browser (an id, a name, a label, a URL parameter) can widen the scope. An
 * admin who is not a super-admin is an ordinary login here. Nothing is ever
 * guessed from names or email addresses: a wrong guess would show one person
 * another person's companies, so the link is the only source.
 *
 * This file is pure — no session, no database — so the loader, the queries
 * and their unit tests can use the rule without a server environment.
 */
export type CollectionScope =
  | { kind: "all" }
  | { kind: "coordinator"; label: string }
  | { kind: "none"; reason: "signed-out" | "unconfigured" | "not-salesperson" | "not-installed" };

/** The Collection Master stores the label as typed by the importer; a link stores the same text. Compared after trimming only — never loosened further. */
const labelKey = (label: string) => label.trim();

/** Whether a company with this Sales Coordinator label is inside the scope. */
export function inScope(scope: CollectionScope, coordinatorLabel: string | null | undefined): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "none") return false;
  return typeof coordinatorLabel === "string" && labelKey(coordinatorLabel) === labelKey(scope.label);
}

/** What a Collection screen says when the scope leaves it empty (never for "all" or a linked coordinator with companies). */
export function scopeMessage(scope: CollectionScope): string | null {
  if (scope.kind !== "none") return null;
  switch (scope.reason) {
    case "unconfigured":
      return "Your login isn't linked to a Sales Coordinator yet, so no companies are shown. Ask a super-admin to link it in the Admin Panel.";
    case "not-salesperson":
      return "Your login is marked as not a Sales Coordinator, so no companies are assigned to you here.";
    case "not-installed":
      return "The Sales Coordinator link isn't set up on this database yet (migration 0120 is pending), so no companies can be shown.";
    default:
      return "Sign in to see your companies.";
  }
}

/** A short line for the screens: whose companies are being shown. */
export function scopeNote(scope: CollectionScope): string | null {
  return scope.kind === "coordinator" ? `Showing the companies assigned to you as Sales Coordinator (${scope.label}).` : null;
}
