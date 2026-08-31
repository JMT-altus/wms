"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { designations, lookupItems } from "@/db/schema";
import type { Employee } from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { KYC_LISTS, type KycListKey } from "@/lib/masters/kyc-dropdowns";

/**
 * Client Master DD — every write for the Client KYC dropdown lists.
 *
 * One generic set of actions over `lookup_items`, the master-list table the
 * app already has, rather than a table per dropdown. Designation is the single
 * exception: it lives in its own `designations` table because
 * `customer_contacts.designation_id` is a foreign key to it, so it can't be
 * folded into the generic store without breaking those rows.
 *
 * Nothing here touches saved client records. Customers store the chosen
 * label as text (`payment_terms`, `transporter`, …), so removing an option
 * changes what is offered next time and leaves history intact.
 */

export type Result = { ok: true; id?: string } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Admin-only, matching the Forms module layout that renders this screen. */
type Denied = { ok: false; error: string };
async function guard(): Promise<{ me: Employee } | { error: Denied }> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { error: { ok: false, error: "Please sign in again." } };
  if (!me.isAdmin) return { error: { ok: false, error: "Client Master DD is restricted to admins." } };
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { error: limited };
  return { me };
}

function defOf(key: KycListKey) {
  return KYC_LISTS.find((l) => l.key === key) ?? null;
}

function revalidate(): void {
  revalidatePath("/forms/client-kyc/cust-dropdown");
  revalidatePath("/forms/client-kyc/new");
  revalidatePath("/master-setup/libraries");
}

function dbError(err: unknown): string {
  const e = err as { code?: string; message?: string; cause?: { code?: string } };
  if (e?.code === "23505" || e?.cause?.code === "23505") return "That option already exists.";
  return `Could not save: ${e?.message ?? String(err)}`;
}

/* ── Read helpers used by the writes ─────────────────────────────────────── */

async function nextSortOrder(key: KycListKey): Promise<number> {
  const def = defOf(key);
  if (!def) return 100;
  if (def.storage === "designations") {
    const [r] = await db
      .select({ max: sql<number | null>`max(${designations.sortOrder})` })
      .from(designations);
    return (r?.max ?? 0) + 10;
  }
  const [r] = await db
    .select({ max: sql<number | null>`max(${lookupItems.sortOrder})` })
    .from(lookupItems)
    .where(eq(lookupItems.listKey, def.lookupKey!));
  return (r?.max ?? 0) + 10;
}

/** Case-insensitive existence check, so a bulk paste can't double up. */
async function existingLabels(key: KycListKey): Promise<Set<string>> {
  const def = defOf(key)!;
  const rows =
    def.storage === "designations"
      ? await db.select({ label: designations.name }).from(designations)
      : await db
          .select({ label: lookupItems.label })
          .from(lookupItems)
          .where(eq(lookupItems.listKey, def.lookupKey!));
  return new Set(rows.map((r) => r.label.toLowerCase()));
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

export async function addKycOption(key: KycListKey, label: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  const clean = label.trim();
  if (!clean) return { ok: false, error: "Enter a value first." };
  if (clean.length > 200) return { ok: false, error: "That's too long." };
  if ((await existingLabels(key)).has(clean.toLowerCase())) {
    return { ok: false, error: `"${clean}" is already on this list.` };
  }

  try {
    const sortOrder = await nextSortOrder(key);
    if (def.storage === "designations") {
      const [row] = await db
        .insert(designations)
        .values({ name: clean, sortOrder })
        .returning({ id: designations.id });
      revalidate();
      return { ok: true, id: row?.id };
    }
    const [row] = await db
      .insert(lookupItems)
      .values({ listKey: def.lookupKey!, label: clean, sortOrder, createdById: g.me.id })
      .returning({ id: lookupItems.id });
    revalidate();
    return { ok: true, id: row?.id };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}

export async function renameKycOption(key: KycListKey, id: string, label: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  const clean = label.trim();
  if (!clean) return { ok: false, error: "A option can't be blank." };
  if (clean.length > 200) return { ok: false, error: "That's too long." };

  try {
    if (def.storage === "designations") {
      await db.update(designations).set({ name: clean }).where(eq(designations.id, id));
    } else {
      await db
        .update(lookupItems)
        .set({ label: clean, updatedAt: new Date() })
        .where(and(eq(lookupItems.id, id), eq(lookupItems.listKey, def.lookupKey!)));
    }
    revalidate();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}

export async function deleteKycOption(key: KycListKey, id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  try {
    if (def.storage === "designations") {
      // Deactivated, never deleted: contacts point at this row by id, and the
      // `is_management` flag drives task visibility. Soft-delete takes it out
      // of every picker while leaving those references whole.
      await db.update(designations).set({ isActive: false }).where(eq(designations.id, id));
    } else {
      // Safe to remove outright — customers store the chosen label as text,
      // so no saved record depends on this row surviving.
      await db
        .delete(lookupItems)
        .where(and(eq(lookupItems.id, id), eq(lookupItems.listKey, def.lookupKey!)));
    }
    revalidate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}

/** Swap one option with its neighbour. Ordering is what the KYC form renders. */
export async function moveKycOption(
  key: KycListKey,
  id: string,
  direction: "up" | "down",
): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  try {
    const rows =
      def.storage === "designations"
        ? await db
            .select({ id: designations.id, sortOrder: designations.sortOrder })
            .from(designations)
            .where(eq(designations.isActive, true))
            .orderBy(asc(designations.sortOrder), asc(designations.name))
        : await db
            .select({ id: lookupItems.id, sortOrder: lookupItems.sortOrder })
            .from(lookupItems)
            .where(and(eq(lookupItems.listKey, def.lookupKey!), eq(lookupItems.isActive, true)))
            .orderBy(asc(lookupItems.sortOrder), asc(lookupItems.label));

    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, error: "That option is no longer on this list." };
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return { ok: true }; // already at the end

    // Rewrite the whole list's sort_order from its new positions rather than
    // swapping two values — seeded rows share sort_order values (all the
    // defaults land on 10/20/…), and swapping equal numbers moves nothing.
    const reordered = [...rows];
    const moved = reordered[i]!;
    reordered[i] = reordered[j]!;
    reordered[j] = moved;

    await db.transaction(async (tx) => {
      for (const [idx, row] of reordered.entries()) {
        const sortOrder = (idx + 1) * 10;
        if (def.storage === "designations") {
          await tx.update(designations).set({ sortOrder }).where(eq(designations.id, row.id));
        } else {
          await tx.update(lookupItems).set({ sortOrder }).where(eq(lookupItems.id, row.id));
        }
      }
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}

/** Paste-many. Blank lines dropped, duplicates skipped, order preserved. */
export async function bulkAddKycOptions(key: KycListKey, text: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  const seen = await existingLabels(key);
  const wanted: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const clean = raw.trim();
    if (!clean || clean.length > 200) continue;
    const k = clean.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    wanted.push(clean);
  }
  if (wanted.length === 0) return { ok: false, error: "Nothing new to add." };

  try {
    let sortOrder = await nextSortOrder(key);
    if (def.storage === "designations") {
      await db
        .insert(designations)
        .values(wanted.map((name) => ({ name, sortOrder: (sortOrder += 10) })));
    } else {
      await db.insert(lookupItems).values(
        wanted.map((label) => ({
          listKey: def.lookupKey!,
          label,
          sortOrder: (sortOrder += 10),
          createdById: g.me.id,
        })),
      );
    }
    revalidate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}

/**
 * Persist this list's built-in defaults so they become editable rows.
 * What the "use defaults" affordance on an untouched list does.
 */
export async function adoptKycDefaults(key: KycListKey): Promise<Result> {
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };
  return bulkAddKycOptions(key, def.defaults.join("\n"));
}

/**
 * Clear this list's saved options, returning it to its built-in defaults.
 *
 * Scoped to the one list — no other list, and no client, product or settings
 * data, is touched. Saved clients keep whatever value they already hold,
 * because those are stored as text on the customer row.
 */
export async function resetKycList(key: KycListKey): Promise<Result> {
  const g = await guard();
  if ("error" in g) return g.error;
  const def = defOf(key);
  if (!def) return { ok: false, error: "Unknown list." };

  // Designation is deliberately not resettable. The `designations` table is
  // shared with the employee roster — `employees.designation_id` points at it
  // and `is_management` there drives task visibility — so clearing the list
  // would deactivate designations that have nothing to do with Client KYC and
  // silently change who can see what. Remove entries one at a time instead.
  if (def.storage === "designations") {
    return {
      ok: false,
      error: "Designation is shared with the employee roster and can't be cleared in bulk.",
    };
  }

  try {
    await db.delete(lookupItems).where(eq(lookupItems.listKey, def.lookupKey!));
    revalidate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbError(err) };
  }
}
