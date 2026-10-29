import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionCoordinatorLinks, employees } from "@/db/schema";
import { listKnownCoordinatorLabels } from "@/lib/queries/collection-master";

/** A login's link state: no row = "unconfigured"; label NULL = "none" (not a Sales Coordinator). */
export type LinkState = { kind: "unconfigured" } | { kind: "none" } | { kind: "label"; label: string };

export interface CoordinatorLinkRow {
  employeeId: string;
  name: string;
  email: string;
  isAdmin: boolean;
  state: LinkState;
}

const isMissingTable = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

export const stateOf = (label: string | null | undefined, hasRow: boolean): LinkState =>
  !hasRow ? { kind: "unconfigured" } : label ? { kind: "label", label } : { kind: "none" };

/**
 * For the Admin Panel's Sales Coordinators page (admins only — the page checks):
 * every active employee with their link state, and the Sales Coordinator labels the
 * Collection Master holds (the only labels a link may use). `storageReady` is false
 * while migration 0120 (or the Collection Master, 0112) isn't installed.
 */
export async function listCoordinatorLinks(): Promise<{ storageReady: boolean; rows: CoordinatorLinkRow[]; labels: string[] }> {
  try {
    const [people, labels] = await Promise.all([
      db
        .select({
          employeeId: employees.id,
          name: employees.name,
          email: employees.email,
          isAdmin: employees.isAdmin,
          linkEmployee: collectionCoordinatorLinks.employeeId,
          label: collectionCoordinatorLinks.coordinatorLabel,
        })
        .from(employees)
        .leftJoin(collectionCoordinatorLinks, eq(collectionCoordinatorLinks.employeeId, employees.id))
        .where(eq(employees.isActive, true))
        .orderBy(asc(employees.name)),
      listKnownCoordinatorLabels(db),
    ]);
    return {
      storageReady: true,
      labels,
      rows: people.map((p) => ({ employeeId: p.employeeId, name: p.name, email: p.email, isAdmin: p.isAdmin, state: stateOf(p.label, p.linkEmployee !== null) })),
    };
  } catch (err) {
    if (isMissingTable(err)) return { storageReady: false, rows: [], labels: [] };
    throw err;
  }
}
