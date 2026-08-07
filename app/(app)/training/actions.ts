"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  selfLearningEntries,
  shareRatings,
  trainingMaterials,
  trainingSessionAttendance,
  trainingSessionFeedback,
  trainingSessions,
  trainingWatches,
  weeklyShares,
} from "@/db/schema";
import {
  SELF_LEARNING_KINDS,
  TRAINING_MATERIAL_KINDS,
  type SelfLearningKind,
  type TrainingMaterialKind,
} from "@/db/enums";
import { orgSettings } from "@/db/schema";
import { getTrainingSettings } from "@/lib/queries/training";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { currentWeekStart } from "@/lib/weekly-goals/week";

export type Result = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const TRAINING_PATHS = [
  "/training",
  "/training/calendar",
  "/training/self-learning",
  "/training/share",
  "/training/obligations",
  "/training/induction",
  "/training/feedback",
  "/training/dashboard",
];
function revalidateTraining(): void {
  for (const p of TRAINING_PATHS) revalidatePath(p);
}

/**
 * The library and the calendar are CURATED: only admins (which is the MD and
 * the admin accounts) may add, edit, archive or delete. Everyone else reads.
 *
 * Contributions — watching, self-learning, the weekly share, ratings and
 * session feedback — are open to everyone but scoped to their OWN row; those
 * actions check `employeeId = me.id` instead of calling this.
 */
async function requireCurator() {
  const me = await requireUser();
  if (!me.isAdmin) {
    return {
      me,
      denied: {
        ok: false as const,
        error: "Only an admin can add or change training material.",
      },
    };
  }
  return { me, denied: null };
}

const trimTo = (v: unknown, n: number): string =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const cleanLink = (v: unknown): string | null => {
  const s = trimTo(v, 1000);
  return s.length > 0 ? s : null;
};

/* ── Library (admin only) ────────────────────────────────────────────────── */

export interface MaterialInput {
  title: string;
  subject?: string | null;
  kind?: string;
  url?: string | null;
  notes?: string | null;
  isInduction?: boolean;
}

export async function createMaterial(input: MaterialInput): Promise<Result> {
  const { me, denied } = await requireCurator();
  if (denied) return denied;
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const title = trimTo(input.title, 300);
  if (!title) return { ok: false, error: "Give the material a name." };
  const kind = (TRAINING_MATERIAL_KINDS as readonly string[]).includes(input.kind ?? "")
    ? (input.kind as TrainingMaterialKind)
    : "video_link";

  try {
    await db.insert(trainingMaterials).values({
      title,
      subject: trimTo(input.subject, 120) || null,
      kind,
      url: cleanLink(input.url),
      notes: trimTo(input.notes, 2000) || null,
      isInduction: !!input.isInduction,
      createdById: me.id,
    });
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

export async function updateMaterial(id: string, input: MaterialInput): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { me, denied } = await requireCurator();
  if (denied) return denied;
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const title = trimTo(input.title, 300);
  if (!title) return { ok: false, error: "Give the material a name." };
  const kind = (TRAINING_MATERIAL_KINDS as readonly string[]).includes(input.kind ?? "")
    ? (input.kind as TrainingMaterialKind)
    : "video_link";

  try {
    await db
      .update(trainingMaterials)
      .set({
        title,
        subject: trimTo(input.subject, 120) || null,
        kind,
        url: cleanLink(input.url),
        notes: trimTo(input.notes, 2000) || null,
        isInduction: !!input.isInduction,
        updatedAt: new Date(),
      })
      .where(eq(trainingMaterials.id, id));
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

export async function setMaterialArchived(id: string, archived: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { denied } = await requireCurator();
  if (denied) return denied;
  await db
    .update(trainingMaterials)
    .set({ archived, updatedAt: new Date() })
    .where(eq(trainingMaterials.id, id));
  revalidateTraining();
  return { ok: true };
}

export async function deleteMaterial(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { denied } = await requireCurator();
  if (denied) return denied;
  await db.delete(trainingMaterials).where(eq(trainingMaterials.id, id));
  revalidateTraining();
  return { ok: true };
}

/* ── Watching (anyone, own row) ──────────────────────────────────────────── */

export async function setWatched(materialId: string, watched: boolean): Promise<Result> {
  if (!isUuid(materialId)) return { ok: false, error: "Invalid id." };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  try {
    if (watched) {
      // The composite PK makes re-watching a no-op rather than a second row.
      await db
        .insert(trainingWatches)
        .values({ materialId, employeeId: me.id })
        .onConflictDoNothing();
    } else {
      await db
        .delete(trainingWatches)
        .where(
          and(
            eq(trainingWatches.materialId, materialId),
            eq(trainingWatches.employeeId, me.id),
          ),
        );
    }
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/* ── Calendar (admin only) ───────────────────────────────────────────────── */

export interface SessionInput {
  title: string;
  scheduledAt: string;
  durationMin?: number;
  trainerId?: string | null;
  location?: string | null;
  notes?: string | null;
}

export async function createSession(input: SessionInput): Promise<Result> {
  const { me, denied } = await requireCurator();
  if (denied) return denied;
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const title = trimTo(input.title, 300);
  if (!title) return { ok: false, error: "Give the session a title." };
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a date and time." };
  const trainerId = isUuid(input.trainerId) ? input.trainerId : null;

  try {
    await db.insert(trainingSessions).values({
      title,
      scheduledAt: when,
      durationMin: Math.max(5, Math.min(600, Math.round(Number(input.durationMin) || 60))),
      trainerId,
      location: trimTo(input.location, 300) || null,
      notes: trimTo(input.notes, 2000) || null,
      createdById: me.id,
    });
  } catch (err) {
    return { ok: false, error: `Could not schedule: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

export async function cancelSession(id: string, cancelled = true): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { denied } = await requireCurator();
  if (denied) return denied;
  await db
    .update(trainingSessions)
    .set({ cancelled, updatedAt: new Date() })
    .where(eq(trainingSessions.id, id));
  revalidateTraining();
  return { ok: true };
}

export async function deleteSession(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const { denied } = await requireCurator();
  if (denied) return denied;
  await db.delete(trainingSessions).where(eq(trainingSessions.id, id));
  revalidateTraining();
  return { ok: true };
}

/** Mark who turned up. Admin only — attendance drives the feedback gate. */
export async function setAttendance(
  sessionId: string,
  employeeId: string,
  present: boolean,
): Promise<Result> {
  if (!isUuid(sessionId) || !isUuid(employeeId)) {
    return { ok: false, error: "Invalid id." };
  }
  const { me, denied } = await requireCurator();
  if (denied) return denied;
  try {
    await db
      .insert(trainingSessionAttendance)
      .values({ sessionId, employeeId, present, markedById: me.id })
      .onConflictDoUpdate({
        target: [trainingSessionAttendance.sessionId, trainingSessionAttendance.employeeId],
        set: { present, markedById: me.id },
      });
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/* ── Self-learning (anyone, own row) ─────────────────────────────────────── */

export interface SelfLearningInput {
  kind: string;
  source: string;
  entryDate: string;
  minutes: number;
  sourceLink?: string | null;
  evidenceLink?: string | null;
  notes?: string | null;
}

export async function logSelfLearning(input: SelfLearningInput): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const source = trimTo(input.source, 300);
  if (!source) return { ok: false, error: "What did you learn from?" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate ?? "")) {
    return { ok: false, error: "Pick a valid date." };
  }
  const minutes = Math.max(1, Math.min(1440, Math.round(Number(input.minutes) || 0)));
  const evidenceLink = cleanLink(input.evidenceLink);
  // Enforced here rather than as a NOT NULL so the user gets a field-level
  // message instead of a constraint error.
  if (!evidenceLink) {
    return { ok: false, error: "Evidence link is required — it's what makes this count." };
  }
  const kind = (SELF_LEARNING_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as SelfLearningKind)
    : "book";

  try {
    await db.insert(selfLearningEntries).values({
      employeeId: me.id,
      kind,
      source,
      entryDate: input.entryDate,
      minutes,
      sourceLink: cleanLink(input.sourceLink),
      evidenceLink,
      notes: trimTo(input.notes, 2000) || null,
    });
  } catch (err) {
    return { ok: false, error: `Could not log: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/** Delete one of your OWN entries. Admins may remove anyone's. */
export async function deleteSelfLearning(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, error: "Invalid id." };
  const me = await requireUser();
  await db
    .delete(selfLearningEntries)
    .where(
      me.isAdmin
        ? eq(selfLearningEntries.id, id)
        : and(eq(selfLearningEntries.id, id), eq(selfLearningEntries.employeeId, me.id)),
    );
  revalidateTraining();
  return { ok: true };
}

/* ── Weekly share (anyone, own row) ──────────────────────────────────────── */

export interface ShareInput {
  topic: string;
  minutes: number;
  videoLink?: string | null;
  notes?: string | null;
}

export async function logWeeklyShare(input: ShareInput): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const topic = trimTo(input.topic, 300);
  if (!topic) return { ok: false, error: "What are you sharing?" };
  const minutes = Math.max(1, Math.min(600, Math.round(Number(input.minutes) || 0)));
  // The minimum is org policy, not a constant — admins set it in Training →
  // Settings, so it's read here rather than baked in.
  const { shareMinMinutes } = await getTrainingSettings();
  if (minutes < shareMinMinutes) {
    return { ok: false, error: `A share has to be at least ${shareMinMinutes} minutes.` };
  }
  const weekStart = currentWeekStart();

  try {
    // One share per person per week — logging again edits this week's entry
    // rather than stacking a second one.
    await db
      .insert(weeklyShares)
      .values({
        employeeId: me.id,
        weekStart,
        topic,
        minutes,
        videoLink: cleanLink(input.videoLink),
        notes: trimTo(input.notes, 2000) || null,
      })
      .onConflictDoUpdate({
        target: [weeklyShares.employeeId, weeklyShares.weekStart],
        set: {
          topic,
          minutes,
          videoLink: cleanLink(input.videoLink),
          notes: trimTo(input.notes, 2000) || null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    return { ok: false, error: `Could not log: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/** Rate a COLLEAGUE's share. Re-rating overwrites your own row. */
export async function rateShare(
  shareId: string,
  rating: number,
  comment?: string | null,
): Promise<Result> {
  if (!isUuid(shareId)) return { ok: false, error: "Invalid id." };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const value = Math.round(Number(rating) || 0);
  if (value < 1 || value > 5) return { ok: false, error: "Pick a rating from 1 to 5." };

  const [share] = await db
    .select({ employeeId: weeklyShares.employeeId })
    .from(weeklyShares)
    .where(eq(weeklyShares.id, shareId))
    .limit(1);
  if (!share) return { ok: false, error: "That share no longer exists." };
  if (share.employeeId === me.id) {
    return { ok: false, error: "You can't rate your own share." };
  }

  try {
    await db
      .insert(shareRatings)
      .values({ shareId, raterId: me.id, rating: value, comment: trimTo(comment, 1000) || null })
      .onConflictDoUpdate({
        target: [shareRatings.shareId, shareRatings.raterId],
        set: { rating: value, comment: trimTo(comment, 1000) || null },
      });
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/* ── Policy settings (admin only) ────────────────────────────────────────── */

export interface TrainingSettingsInput {
  selfLearningTargetMin: number;
  shareMinMinutes: number;
  cadenceDays: number;
}

/**
 * The three policy numbers behind the module. Bounds mirror the CHECK
 * constraint in migration 0080 so a bad value is rejected with a readable
 * message rather than a constraint error.
 */
export async function saveTrainingSettings(
  input: TrainingSettingsInput,
): Promise<Result> {
  const { me, denied } = await requireCurator();
  if (denied) {
    return { ok: false, error: "Only an admin can change training policy." };
  }
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const target = Math.round(Number(input.selfLearningTargetMin));
  const share = Math.round(Number(input.shareMinMinutes));
  const cadence = Math.round(Number(input.cadenceDays));

  if (!Number.isFinite(target) || target < 1 || target > 10080) {
    return { ok: false, error: "Self-learning target must be between 1 and 10080 minutes." };
  }
  if (!Number.isFinite(share) || share < 1 || share > 600) {
    return { ok: false, error: "Share minimum must be between 1 and 600 minutes." };
  }
  if (!Number.isFinite(cadence) || cadence < 1 || cadence > 365) {
    return { ok: false, error: "Session cadence must be between 1 and 365 days." };
  }

  try {
    await db
      .update(orgSettings)
      .set({
        trainingSelfLearningTargetMin: target,
        trainingShareMinMinutes: share,
        trainingCadenceDays: cadence,
        updatedAt: new Date(),
        updatedById: me.id,
      })
      .where(eq(orgSettings.id, 1));
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}

/* ── Session feedback (attendees only, own row) ──────────────────────────── */

export async function rateSession(
  sessionId: string,
  rating: number,
  comment?: string | null,
): Promise<Result> {
  if (!isUuid(sessionId)) return { ok: false, error: "Invalid id." };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const value = Math.round(Number(rating) || 0);
  if (value < 1 || value > 5) return { ok: false, error: "Pick a rating from 1 to 5." };

  // Only people marked present may rate — otherwise a session's score reflects
  // opinions of people who weren't in the room. Admins are exempt so they can
  // record feedback given verbally.
  if (!me.isAdmin) {
    const [att] = await db
      .select({ present: trainingSessionAttendance.present })
      .from(trainingSessionAttendance)
      .where(
        and(
          eq(trainingSessionAttendance.sessionId, sessionId),
          eq(trainingSessionAttendance.employeeId, me.id),
        ),
      )
      .limit(1);
    if (!att?.present) {
      return { ok: false, error: "Only attendees can rate this session." };
    }
  }

  try {
    await db
      .insert(trainingSessionFeedback)
      .values({
        sessionId,
        employeeId: me.id,
        rating: value,
        comment: trimTo(comment, 2000) || null,
      })
      .onConflictDoUpdate({
        target: [trainingSessionFeedback.sessionId, trainingSessionFeedback.employeeId],
        set: { rating: value, comment: trimTo(comment, 2000) || null },
      });
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
  revalidateTraining();
  return { ok: true };
}
