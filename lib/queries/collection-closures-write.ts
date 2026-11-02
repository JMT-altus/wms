import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { collectionClosures } from "@/db/schema";
import { TRACKER_BALANCES_SOURCE } from "@/lib/queries/collection-master";
import { paiseText, planClosures, type UploadedLine } from "@/lib/collections/balances/closures";

/**
 * The ONLY writer of collection_closures: moves companies between the
 * Collection Tracker and Collection Logs after a confirmed balance upload.
 *
 * Called inside the upload's own transaction, after its lines are written, so
 * the new balances and the movement commit together or not at all. A refused,
 * previewed or failed upload never gets here.
 *
 * Append-only, as migration 0119 intends. Moving to Logs INSERTS an open
 * closure episode; returning to the Tracker sets that episode's reopening
 * fields. Nothing is deleted, and no company, coordinator, payment terms,
 * follow-up, comment, commitment, confirmation or escalation is touched: the
 * company keeps its one Collection Master id throughout. The database itself
 * allows at most one open episode per company (collection_closures_one_open_uq).
 *
 * Without the table (0119 not applied in this database), nothing moves and the
 * upload itself still completes; the result says so.
 */

type Tx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export interface ClosureMovement {
  status: "ok" | "not-installed";
  /** Companies moved to Collection Logs by this upload. */
  toLogs: number;
  /** Companies returned from Collection Logs to the Tracker by this upload. */
  toTracker: number;
}

async function closuresInstalled(tx: Tx): Promise<boolean> {
  const res = await tx.execute(sql`select to_regclass('public.collection_closures') is not null as ok`);
  const rows = (res as unknown as { rows?: { ok: boolean }[] }).rows ?? (res as unknown as { ok: boolean }[]);
  return rows[0]?.ok === true;
}

export async function applyClosureMovement(
  tx: Tx,
  input: { snapshotId: string; asOfDate: string | null; uploadedById: string; lines: readonly UploadedLine[] },
): Promise<ClosureMovement> {
  if (!(await closuresInstalled(tx))) return { status: "not-installed", toLogs: 0, toTracker: 0 };
  const ids = [...new Set(input.lines.map((l) => l.companyId))];
  if (ids.length === 0) return { status: "ok", toLogs: 0, toTracker: 0 };

  const open = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await tx
      .select({ companyId: collectionClosures.companyId })
      .from(collectionClosures)
      .where(and(inArray(collectionClosures.companyId, ids.slice(i, i + 1000)), isNull(collectionClosures.reopenedAt)));
    for (const r of rows) open.add(r.companyId);
  }

  const plan = planClosures(input.lines, open);

  for (let i = 0; i < plan.close.length; i += 500) {
    await tx.insert(collectionClosures).values(
      plan.close.slice(i, i + 500).map((l) => ({
        companyId: l.companyId,
        closeReason: "outstanding_zero" as const,
        closeSourceKey: TRACKER_BALANCES_SOURCE,
        closeSourceRef: input.snapshotId,
        finalOutstanding: "0.00",
        finalDebit: paiseText(l.debitPaise),
        finalCredit: paiseText(l.creditPaise),
        asOfDate: input.asOfDate,
        closedById: input.uploadedById,
      })),
    );
  }

  let reopened = 0;
  for (const l of plan.reopen) {
    const done = await tx
      .update(collectionClosures)
      .set({ reopenedAt: sql`now()`, reopenReason: "outstanding_positive", reopenSourceRef: input.snapshotId, reopenedById: input.uploadedById })
      .where(and(eq(collectionClosures.companyId, l.companyId), isNull(collectionClosures.reopenedAt)))
      .returning({ id: collectionClosures.id });
    reopened += done.length;
  }

  return { status: "ok", toLogs: plan.close.length, toTracker: reopened };
}
