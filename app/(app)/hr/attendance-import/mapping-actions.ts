"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { biometricEmployeeMap, employeeEvents, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import {
  normalizeCode,
  normalizeName,
  resolveSavedMappings,
  usableCode,
  type MappingTarget,
  type SavedMapping,
  type Suggestion,
} from "@/lib/attendance/import/auto-map";

/**
 * Saved biometric-code → JMT-employee matches (table biometric_employee_map).
 *
 * Reading is for pre-selecting people on the Attendance Bulk Upload page. Writing
 * happens ONLY through `saveConfirmedMappings`, i.e. when an admin has reviewed
 * the matches and ticked the confirmation — nothing is ever saved automatically,
 * seeded, or guessed.
 *
 * A saved match is never silently reassigned: changing the person a code points
 * to (or giving a person a second code) is refused unless that exact item is sent
 * with `replace: true`, and the whole save is one transaction, so a failure leaves
 * the table exactly as it was. Every create / change / removal is written to
 * employee_events in the same transaction.
 *
 * Auto-selection is only a convenience: the import actions still validate the
 * FINAL mapping on the server (active employee, no two codes on one person).
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_ITEMS = 500;

const SourceSchema = z.object({
  key: z.string().min(1).max(120),
  code: z.string().max(120),
  name: z.string().max(200),
});
const LookupSchema = z.object({ sources: z.array(SourceSchema).min(1).max(MAX_ITEMS) });

/** Read-only: which of these file rows can be pre-selected, and why not for the rest. */
export async function lookupSavedMappings(raw: unknown): Promise<Result<{ suggestions: Record<string, Suggestion> }>> {
  await requireAdmin();
  const parsed = LookupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };

  const codes = [...new Set(parsed.data.sources.map((s) => usableCode(s.code)).filter((c): c is string => !!c))];
  const saved = new Map<string, SavedMapping>();
  if (codes.length > 0) {
    const rows = await db
      .select({
        code: biometricEmployeeMap.biometricCode,
        employeeId: biometricEmployeeMap.employeeId,
        nameInFile: biometricEmployeeMap.nameInFile,
        confirmedAt: biometricEmployeeMap.confirmedAt,
      })
      .from(biometricEmployeeMap)
      .where(inArray(biometricEmployeeMap.biometricCode, codes));
    for (const r of rows) {
      saved.set(r.code, { code: r.code, employeeId: r.employeeId, nameInFile: r.nameInFile, confirmedAt: r.confirmedAt.toISOString() });
    }
  }

  const targets = new Map<string, MappingTarget>();
  const ids = [...new Set([...saved.values()].map((s) => s.employeeId))];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: employees.id, name: employees.name, email: employees.email, isActive: employees.isActive })
      .from(employees)
      .where(inArray(employees.id, ids));
    for (const r of rows) targets.set(r.id, r);
  }

  return { ok: true, suggestions: resolveSavedMappings(parsed.data.sources, saved, targets) };
}

const ItemSchema = z.object({
  code: z.string().trim().min(1, "A code is required.").max(120),
  name: z.string().max(200),
  employeeId: z.string().uuid(),
  /** Must be true to change an existing link (a different person for this code, or a second code for this person). */
  replace: z.boolean().optional(),
});
const SaveSchema = z.object({
  items: z.array(ItemSchema).min(1, "Nothing to save.").max(MAX_ITEMS),
  /** The admin ticked "I have reviewed these matches". */
  acknowledged: z.literal(true),
});

export interface MappingConflict {
  code: string;
  employeeId: string;
  employeeName: string;
  messages: string[];
}

export interface SaveMappingsResult {
  created: number;
  /** Same person, refreshed the name HR confirmed. */
  confirmed: number;
  /** An existing link was deliberately changed (replace = true). */
  changed: number;
  unchanged: number;
}

type Outcome = "unchanged" | "created" | "confirmed" | "changed";

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && ((err as { code?: string }).code === "23505" || /duplicate key|unique constraint/i.test(String((err as Error).message)));

/**
 * Saves matches an admin has reviewed. All-or-nothing, in one transaction.
 * An item that would change an existing link without `replace: true` makes the
 * whole call return `conflicts` and write nothing.
 */
export async function saveConfirmedMappings(
  raw: unknown,
): Promise<Result<{ saved: SaveMappingsResult }> | { ok: false; error: string; conflicts: MappingConflict[] }> {
  const me = await requireAdmin();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const parsed = SaveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Review and confirm the matches first." };
  }
  const items = parsed.data.items.map((i) => ({ ...i, code: normalizeCode(i.code) }));

  // The save itself is strict: no placeholder codes, no code or person twice in one request.
  if (items.some((i) => usableCode(i.code) === null)) return { ok: false, error: "A match has no real employee code, so it can't be saved." };
  if (new Set(items.map((i) => i.code)).size !== items.length) return { ok: false, error: "The same code is in the list more than once." };
  if (new Set(items.map((i) => i.employeeId)).size !== items.length) {
    return { ok: false, error: "The same JMT employee is matched to more than one code." };
  }

  const codes = items.map((i) => i.code);
  const ids = items.map((i) => i.employeeId);

  try {
    const outcome = await db.transaction(async (tx) => {
      // Lock every row that could be touched, so two saves can't interleave.
      const rows = await tx
        .select({
          id: biometricEmployeeMap.id,
          code: biometricEmployeeMap.biometricCode,
          employeeId: biometricEmployeeMap.employeeId,
          nameInFile: biometricEmployeeMap.nameInFile,
        })
        .from(biometricEmployeeMap)
        .where(or(inArray(biometricEmployeeMap.biometricCode, codes), inArray(biometricEmployeeMap.employeeId, ids)))
        .for("update");

      const people = await tx
        .select({ id: employees.id, name: employees.name, isActive: employees.isActive })
        .from(employees)
        .where(inArray(employees.id, [...new Set([...ids, ...rows.map((r) => r.employeeId)])]));
      const person = new Map(people.map((p) => [p.id, p]));

      // Every target must be a real, active JMT employee — checked here, not trusted from the browser.
      for (const i of items) {
        const p = person.get(i.employeeId);
        if (!p) return { ok: false as const, error: `Code ${i.code}: the chosen employee no longer exists.` };
        if (!p.isActive) return { ok: false as const, error: `Code ${i.code}: ${p.name} is inactive and can't be saved as a match.` };
      }

      const byCode = new Map(rows.map((r) => [r.code, r]));
      const byEmployee = new Map(rows.map((r) => [r.employeeId, r]));
      const nameOf = (id: string) => person.get(id)?.name ?? "another employee";

      const plan = items.map((i) => {
        const cur = byCode.get(i.code); // this code's saved row, if any
        const other = byEmployee.get(i.employeeId); // this person's saved row, if any
        if (cur && cur.employeeId === i.employeeId) {
          const same = normalizeName(cur.nameInFile) === normalizeName(i.name);
          return { i, cur, other: undefined, outcome: (same ? "unchanged" : "confirmed") as Outcome, messages: [] as string[] };
        }
        const messages: string[] = [];
        if (cur) messages.push(`Code ${i.code} is already saved for ${nameOf(cur.employeeId)}. Saving would move it to ${nameOf(i.employeeId)}.`);
        if (other) messages.push(`${nameOf(i.employeeId)} is already saved with code ${other.code}. Saving would replace that code.`);
        return { i, cur, other, outcome: (messages.length ? "changed" : "created") as Outcome, messages };
      });

      // Never reassign silently: every changing item needs its own explicit replace.
      const conflicts: MappingConflict[] = plan
        .filter((p) => p.outcome === "changed" && !p.i.replace)
        .map((p) => ({ code: p.i.code, employeeId: p.i.employeeId, employeeName: nameOf(p.i.employeeId), messages: p.messages }));
      if (conflicts.length > 0) {
        return {
          ok: false as const,
          error: "Some matches would change an existing link. Review them and confirm each change.",
          conflicts,
        };
      }

      // Delete first, insert after, so a swap can't trip the unique indexes midway.
      const removeIds = new Set<string>();
      for (const p of plan) {
        if (p.outcome === "unchanged") continue;
        if (p.cur) removeIds.add(p.cur.id);
        if (p.other) removeIds.add(p.other.id);
      }
      if (removeIds.size > 0) await tx.delete(biometricEmployeeMap).where(inArray(biometricEmployeeMap.id, [...removeIds]));

      const writes = plan.filter((p) => p.outcome !== "unchanged");
      if (writes.length > 0) {
        await tx.insert(biometricEmployeeMap).values(
          writes.map((p) => ({
            biometricCode: p.i.code,
            employeeId: p.i.employeeId,
            nameInFile: p.i.name.trim(),
            confirmedById: me.id,
          })),
        );
      }

      // Audit, same transaction: who, what, and the previous link.
      const events: (typeof employeeEvents.$inferInsert)[] = [];
      for (const p of writes) {
        const to = { code: p.i.code, nameInFile: p.i.name.trim() };
        if (p.outcome === "created") {
          events.push({
            employeeId: p.i.employeeId, actorId: me.id, eventType: "biometric_map_created", toValue: to,
            note: `Biometric code ${p.i.code} linked to ${nameOf(p.i.employeeId)}`,
          });
        } else if (p.outcome === "confirmed") {
          events.push({
            employeeId: p.i.employeeId, actorId: me.id, eventType: "biometric_map_confirmed",
            fromValue: { code: p.i.code, nameInFile: p.cur?.nameInFile ?? "" }, toValue: to,
            note: `Biometric code ${p.i.code} re-confirmed for ${nameOf(p.i.employeeId)}; name in file updated`,
          });
        } else {
          events.push({
            employeeId: p.i.employeeId, actorId: me.id, eventType: "biometric_map_changed",
            fromValue: {
              code: p.cur ? p.cur.code : (p.other?.code ?? null),
              previousEmployeeId: p.cur?.employeeId ?? null,
              previousEmployeeName: p.cur ? nameOf(p.cur.employeeId) : null,
              previousCodeOfThisEmployee: p.other?.code ?? null,
            },
            toValue: to,
            note: `Biometric code ${p.i.code} now links to ${nameOf(p.i.employeeId)} (explicitly confirmed)`,
          });
          if (p.cur && p.cur.employeeId !== p.i.employeeId) {
            events.push({
              employeeId: p.cur.employeeId, actorId: me.id, eventType: "biometric_map_removed",
              fromValue: { code: p.cur.code, nameInFile: p.cur.nameInFile }, toValue: { reassignedTo: p.i.employeeId },
              note: `Biometric code ${p.cur.code} moved from ${nameOf(p.cur.employeeId)} to ${nameOf(p.i.employeeId)}`,
            });
          }
        }
      }
      if (events.length > 0) await tx.insert(employeeEvents).values(events);

      const count = (o: Outcome) => plan.filter((p) => p.outcome === o).length;
      return {
        ok: true as const,
        saved: { created: count("created"), confirmed: count("confirmed"), changed: count("changed"), unchanged: count("unchanged") },
      };
    });
    if (outcome.ok) revalidatePath("/hr/attendance-import");
    return outcome;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Another change to these matches happened at the same moment. Reload the page and try again." };
    }
    console.error("[attendance-import] saving biometric mappings failed", err);
    return { ok: false, error: "The matches could not be saved. Nothing was changed." };
  }
}
