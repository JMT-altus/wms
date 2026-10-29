"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionCoordinatorLinks, employeeEvents, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { rateLimitOrError } from "@/lib/rate-limit";
import { listKnownCoordinatorLabels } from "@/lib/queries/collection-master";
import { stateOf, type LinkState } from "@/lib/queries/coordinator-links";

/**
 * Link a login to its Sales Coordinator label — what decides whose scorecard the
 * Collection Tracker shows that person. It shapes what someone can see, so it is
 * kept like the other access-shaping settings: SUPER-ADMINS ONLY (the existing
 * SUPER_ADMIN_EMAILS root of trust), checked here from the signed session. Nobody
 * can change their OWN link — another super-admin must — so a login can never
 * point itself at someone else's clients.
 *
 * The label must be one the Collection Master holds (exact spelling); a label can
 * belong to one login only; "none" marks a login as explicitly not a Sales
 * Coordinator; "clear" removes the link (back to not configured). The change only
 * goes through if the link is still what the admin saw (`expected`), and it is
 * audited in employee_events in the same transaction. Nothing is ever linked
 * automatically or guessed from names, initials or emails.
 */

const StateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unconfigured") }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("label"), label: z.string().min(1).max(200) }).strict(),
]);
const Input = z
  .object({
    employeeId: z.string().uuid("Choose an employee."),
    choice: StateSchema,
    expected: StateSchema,
  })
  .strict();

type Result = { ok: true; changed: boolean } | { ok: false; error: string };

const LINK_EVENT = "collection_coordinator_link_set";
const NOT_READY = "Sales Coordinator links aren't set up on this database yet (database update 0120 is needed), so nothing was saved.";
const same = (a: LinkState, b: LinkState) => a.kind === b.kind && (a.kind !== "label" || a.label === (b as { label: string }).label);

class Refused extends Error {}

export async function setCoordinatorLink(raw: unknown): Promise<Result> {
  const me = await requireAdmin();
  if (!isSuperAdmin(me.email)) return { ok: false, error: "Only a super-admin can link logins to Sales Coordinators." };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { employeeId, choice, expected } = parsed.data;
  if (employeeId === me.id) return { ok: false, error: "You can't change your own Sales Coordinator link. Ask another super-admin." };

  try {
    const changed = await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: employees.id, isActive: employees.isActive }).from(employees).where(eq(employees.id, employeeId));
      if (!target || !target.isActive) throw new Refused("That employee no longer exists or is inactive.");

      const [row] = await tx
        .select({ label: collectionCoordinatorLinks.coordinatorLabel })
        .from(collectionCoordinatorLinks)
        .where(eq(collectionCoordinatorLinks.employeeId, employeeId))
        .for("update");
      const current = stateOf(row?.label, !!row);
      if (!same(current, expected)) throw new Refused("This link was changed by someone else since you opened the page. Reload and try again.");
      if (same(current, choice)) return false;

      if (choice.kind === "label") {
        const known = await listKnownCoordinatorLabels(tx as unknown as typeof db);
        if (!known.includes(choice.label)) throw new Refused("That Sales Coordinator isn't in the Collection Master. Choose one from the list.");
        const [holder] = await tx
          .select({ name: employees.name })
          .from(collectionCoordinatorLinks)
          .innerJoin(employees, eq(employees.id, collectionCoordinatorLinks.employeeId))
          .where(and(eq(collectionCoordinatorLinks.coordinatorLabel, choice.label), ne(collectionCoordinatorLinks.employeeId, employeeId)));
        if (holder) throw new Refused(`"${choice.label}" is already linked to ${holder.name}. Unlink it there first.`);
      }

      if (choice.kind === "unconfigured") {
        await tx.delete(collectionCoordinatorLinks).where(eq(collectionCoordinatorLinks.employeeId, employeeId));
      } else {
        const label = choice.kind === "label" ? choice.label : null;
        await tx
          .insert(collectionCoordinatorLinks)
          .values({ employeeId, coordinatorLabel: label, setById: me.id })
          .onConflictDoUpdate({ target: collectionCoordinatorLinks.employeeId, set: { coordinatorLabel: label, setById: me.id, setAt: new Date() } });
      }
      await tx.insert(employeeEvents).values({
        employeeId,
        actorId: me.id,
        eventType: LINK_EVENT,
        fromValue: current,
        toValue: choice,
        note:
          choice.kind === "label" ? `Linked to Sales Coordinator "${choice.label}"`
          : choice.kind === "none" ? "Marked as not a Sales Coordinator"
          : "Sales Coordinator link removed",
      });
      return true;
    });
    if (changed) {
      revalidatePath("/admin/sales-coordinators");
      revalidatePath("/forms/collection/tracker");
    }
    return { ok: true, changed };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    const e = err as { code?: string; cause?: { code?: string } } | null;
    const code = e?.code ?? e?.cause?.code;
    if (code === "42P01") return { ok: false, error: NOT_READY };
    if (code === "23505") return { ok: false, error: "That Sales Coordinator was just linked to another login. Reload and try again." };
    console.error("[sales-coordinators] link change failed", { code: code ?? null });
    return { ok: false, error: "The link could not be saved, so nothing was changed. Please try again." };
  }
}
