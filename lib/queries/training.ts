import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  employees,
  selfLearningEntries,
  shareRatings,
  trainingMaterials,
  trainingSessionAttendance,
  trainingSessionFeedback,
  trainingSessions,
  trainingWatches,
  weeklyShares,
} from "@/db/schema";
import type { SelfLearningKind, TrainingMaterialKind } from "@/db/enums";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { currentWeekStart, istYmd, monthStart } from "@/lib/weekly-goals/week";

/**
 * The three policy numbers, read from org_settings so admins can change them
 * without a code change (migration 0080). Everything below reads them from
 * here rather than importing a constant — a hardcoded target is exactly what
 * this module was asked not to have.
 */
export interface TrainingSettings {
  selfLearningTargetMin: number;
  shareMinMinutes: number;
  cadenceDays: number;
}

export async function getTrainingSettings(): Promise<TrainingSettings> {
  const s = await getOrgSettings();
  return {
    selfLearningTargetMin: s.trainingSelfLearningTargetMin,
    shareMinMinutes: s.trainingShareMinMinutes,
    cadenceDays: s.trainingCadenceDays,
  };
}

/* ── Library ─────────────────────────────────────────────────────────────── */

export interface MaterialRow {
  id: string;
  title: string;
  subject: string | null;
  kind: TrainingMaterialKind;
  url: string | null;
  isInduction: boolean;
  archived: boolean;
  createdAt: Date;
  createdByName: string | null;
  /** Whether the VIEWER has watched it. */
  watchedByMe: boolean;
  /** How many people have watched it, across the team. */
  watchCount: number;
}

export async function listMaterials(opts: {
  viewerId: string;
  includeArchived?: boolean;
}): Promise<MaterialRow[]> {
  const creator = alias(employees, "material_creator");
  const rows = await db
    .select({
      id: trainingMaterials.id,
      title: trainingMaterials.title,
      subject: trainingMaterials.subject,
      kind: trainingMaterials.kind,
      url: trainingMaterials.url,
      isInduction: trainingMaterials.isInduction,
      archived: trainingMaterials.archived,
      createdAt: trainingMaterials.createdAt,
      createdByName: creator.name,
      watchCount: sql<number>`(
        select count(*)::int from training_watches w where w.material_id = ${trainingMaterials.id}
      )`,
      watchedByMe: sql<boolean>`exists (
        select 1 from training_watches w
         where w.material_id = ${trainingMaterials.id} and w.employee_id = ${opts.viewerId}
      )`,
    })
    .from(trainingMaterials)
    .leftJoin(creator, eq(creator.id, trainingMaterials.createdById))
    .where(opts.includeArchived ? undefined : eq(trainingMaterials.archived, false))
    .orderBy(desc(trainingMaterials.createdAt));
  return rows.map((r) => ({ ...r, createdByName: r.createdByName ?? null }));
}

/** Distinct non-empty subjects, for the Library filter. */
export async function listMaterialSubjects(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ subject: trainingMaterials.subject })
    .from(trainingMaterials);
  return rows
    .map((r) => r.subject)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .sort();
}

/* ── Induction ───────────────────────────────────────────────────────────── */

export interface InductionProgress {
  items: { id: string; title: string; subject: string | null; url: string | null; watched: boolean }[];
  done: number;
  total: number;
  pct: number;
}

export async function getInductionProgress(employeeId: string): Promise<InductionProgress> {
  const rows = await db
    .select({
      id: trainingMaterials.id,
      title: trainingMaterials.title,
      subject: trainingMaterials.subject,
      url: trainingMaterials.url,
      watched: sql<boolean>`exists (
        select 1 from training_watches w
         where w.material_id = ${trainingMaterials.id} and w.employee_id = ${employeeId}
      )`,
    })
    .from(trainingMaterials)
    .where(
      and(eq(trainingMaterials.isInduction, true), eq(trainingMaterials.archived, false)),
    )
    .orderBy(asc(trainingMaterials.createdAt));

  const done = rows.filter((r) => r.watched).length;
  const total = rows.length;
  return { items: rows, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

export interface SessionRow {
  id: string;
  title: string;
  scheduledAt: Date;
  durationMin: number;
  trainerName: string | null;
  location: string | null;
  notes: string | null;
  cancelled: boolean;
  attendeeCount: number;
  /** Average of attendee feedback, null when nobody has rated yet. */
  avgRating: number | null;
  ratingCount: number;
}

async function selectSessions(where: ReturnType<typeof and>, order: "asc" | "desc") {
  const trainer = alias(employees, "session_trainer");
  return db
    .select({
      id: trainingSessions.id,
      title: trainingSessions.title,
      scheduledAt: trainingSessions.scheduledAt,
      durationMin: trainingSessions.durationMin,
      trainerName: trainer.name,
      location: trainingSessions.location,
      notes: trainingSessions.notes,
      cancelled: trainingSessions.cancelled,
      attendeeCount: sql<number>`(
        select count(*)::int from training_session_attendance a
         where a.session_id = ${trainingSessions.id} and a.present
      )`,
      avgRating: sql<number | null>`(
        select round(avg(f.rating)::numeric, 1)::float8 from training_session_feedback f
         where f.session_id = ${trainingSessions.id}
      )`,
      ratingCount: sql<number>`(
        select count(*)::int from training_session_feedback f
         where f.session_id = ${trainingSessions.id}
      )`,
    })
    .from(trainingSessions)
    .leftJoin(trainer, eq(trainer.id, trainingSessions.trainerId))
    .where(where)
    .orderBy(
      order === "asc" ? asc(trainingSessions.scheduledAt) : desc(trainingSessions.scheduledAt),
    )
    .limit(100);
}

export async function listUpcomingSessions(): Promise<SessionRow[]> {
  const rows = await selectSessions(
    and(gte(trainingSessions.scheduledAt, new Date()), eq(trainingSessions.cancelled, false)),
    "asc",
  );
  return rows.map((r) => ({ ...r, trainerName: r.trainerName ?? null }));
}

export async function listPastSessions(limit = 20): Promise<SessionRow[]> {
  const rows = await selectSessions(lte(trainingSessions.scheduledAt, new Date()), "desc");
  return rows.slice(0, limit).map((r) => ({ ...r, trainerName: r.trainerName ?? null }));
}

/** Days since the most recent non-cancelled session; null when there's none. */
export async function daysSinceLastSession(): Promise<number | null> {
  const [row] = await db
    .select({ last: sql<Date | null>`max(scheduled_at)` })
    .from(trainingSessions)
    .where(
      and(eq(trainingSessions.cancelled, false), lte(trainingSessions.scheduledAt, new Date())),
    );
  if (!row?.last) return null;
  const ms = Date.now() - new Date(row.last).getTime();
  return Math.floor(ms / 86_400_000);
}

/* ── Self-learning ───────────────────────────────────────────────────────── */

export interface SelfLearningRow {
  id: string;
  kind: SelfLearningKind;
  source: string;
  entryDate: string;
  minutes: number;
  sourceLink: string | null;
  evidenceLink: string | null;
  notes: string | null;
  employeeName?: string | null;
}

export interface SelfLearningMonth {
  entries: SelfLearningRow[];
  minutesLogged: number;
  targetMinutes: number;
  /** Minutes still to go, floored at zero. */
  remaining: number;
  monthLabel: string;
}

export async function getSelfLearningMonth(
  employeeId: string,
  now: Date = new Date(),
): Promise<SelfLearningMonth> {
  const start = monthStart(now);
  const { selfLearningTargetMin } = await getTrainingSettings();
  const rows = await db
    .select({
      id: selfLearningEntries.id,
      kind: selfLearningEntries.kind,
      source: selfLearningEntries.source,
      entryDate: selfLearningEntries.entryDate,
      minutes: selfLearningEntries.minutes,
      sourceLink: selfLearningEntries.sourceLink,
      evidenceLink: selfLearningEntries.evidenceLink,
      notes: selfLearningEntries.notes,
    })
    .from(selfLearningEntries)
    .where(
      and(
        eq(selfLearningEntries.employeeId, employeeId),
        gte(selfLearningEntries.entryDate, start),
      ),
    )
    .orderBy(desc(selfLearningEntries.entryDate));

  // Only evidenced entries count toward the target — that's the rule the form
  // states, so the progress bar has to apply it or the number is a lie.
  const minutesLogged = rows
    .filter((r) => (r.evidenceLink ?? "").trim().length > 0)
    .reduce((s, r) => s + r.minutes, 0);

  return {
    entries: rows,
    minutesLogged,
    targetMinutes: selfLearningTargetMin,
    remaining: Math.max(0, selfLearningTargetMin - minutesLogged),
    monthLabel: new Date(`${start}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/* ── Weekly share ────────────────────────────────────────────────────────── */

export interface ShareRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  weekStart: string;
  topic: string;
  minutes: number;
  videoLink: string | null;
  notes: string | null;
  avgRating: number | null;
  ratingCount: number;
  /** The viewer's own rating of this share, if they've given one. */
  myRating: number | null;
}

export async function getMyShare(
  employeeId: string,
  weekStart: string,
): Promise<ShareRow | null> {
  const [row] = await db
    .select({
      id: weeklyShares.id,
      employeeId: weeklyShares.employeeId,
      employeeName: employees.name,
      weekStart: weeklyShares.weekStart,
      topic: weeklyShares.topic,
      minutes: weeklyShares.minutes,
      videoLink: weeklyShares.videoLink,
      notes: weeklyShares.notes,
      avgRating: sql<number | null>`(
        select round(avg(r.rating)::numeric, 1)::float8 from share_ratings r where r.share_id = ${weeklyShares.id}
      )`,
      ratingCount: sql<number>`(
        select count(*)::int from share_ratings r where r.share_id = ${weeklyShares.id}
      )`,
    })
    .from(weeklyShares)
    .leftJoin(employees, eq(employees.id, weeklyShares.employeeId))
    .where(
      and(eq(weeklyShares.employeeId, employeeId), eq(weeklyShares.weekStart, weekStart)),
    )
    .limit(1);
  if (!row) return null;
  return { ...row, employeeName: row.employeeName ?? null, myRating: null };
}

/** Colleagues' shares (everyone but the viewer), most recent week first. */
export async function listColleagueShares(
  viewerId: string,
  limit = 20,
): Promise<ShareRow[]> {
  const rows = await db
    .select({
      id: weeklyShares.id,
      employeeId: weeklyShares.employeeId,
      employeeName: employees.name,
      weekStart: weeklyShares.weekStart,
      topic: weeklyShares.topic,
      minutes: weeklyShares.minutes,
      videoLink: weeklyShares.videoLink,
      notes: weeklyShares.notes,
      avgRating: sql<number | null>`(
        select round(avg(r.rating)::numeric, 1)::float8 from share_ratings r where r.share_id = ${weeklyShares.id}
      )`,
      ratingCount: sql<number>`(
        select count(*)::int from share_ratings r where r.share_id = ${weeklyShares.id}
      )`,
      myRating: sql<number | null>`(
        select r.rating from share_ratings r
         where r.share_id = ${weeklyShares.id} and r.rater_id = ${viewerId}
      )`,
    })
    .from(weeklyShares)
    .leftJoin(employees, eq(employees.id, weeklyShares.employeeId))
    .where(sql`${weeklyShares.employeeId} <> ${viewerId}`)
    .orderBy(desc(weeklyShares.weekStart), desc(weeklyShares.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, employeeName: r.employeeName ?? null }));
}

/* ── Obligations (fully derived — no table of its own) ───────────────────── */

export interface ObligationRow {
  employeeId: string;
  employeeName: string;
  inductionDone: number;
  inductionTotal: number;
  inductionPct: number;
  selfLearningMinutes: number;
  selfLearningTarget: number;
  sharedThisWeek: boolean;
  materialsWatched: number;
  materialsTotal: number;
}

export async function listObligations(now: Date = new Date()): Promise<ObligationRow[]> {
  const week = currentWeekStart(now);
  const month = monthStart(now);
  const { selfLearningTargetMin } = await getTrainingSettings();

  const [people, inductionTotalRow, materialTotalRow, watchRows, learnRows, shareRows, inductionWatchRows] =
    await Promise.all([
      db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(eq(employees.isActive, true))
        .orderBy(asc(employees.name)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trainingMaterials)
        .where(
          and(eq(trainingMaterials.isInduction, true), eq(trainingMaterials.archived, false)),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trainingMaterials)
        .where(eq(trainingMaterials.archived, false)),
      db
        .select({ employeeId: trainingWatches.employeeId, n: sql<number>`count(*)::int` })
        .from(trainingWatches)
        .groupBy(trainingWatches.employeeId),
      db
        .select({
          employeeId: selfLearningEntries.employeeId,
          minutes: sql<number>`coalesce(sum(${selfLearningEntries.minutes}), 0)::int`,
        })
        .from(selfLearningEntries)
        .where(
          and(
            gte(selfLearningEntries.entryDate, month),
            sql`coalesce(trim(${selfLearningEntries.evidenceLink}), '') <> ''`,
          ),
        )
        .groupBy(selfLearningEntries.employeeId),
      db
        .select({ employeeId: weeklyShares.employeeId })
        .from(weeklyShares)
        .where(eq(weeklyShares.weekStart, week)),
      db
        .select({ employeeId: trainingWatches.employeeId, n: sql<number>`count(*)::int` })
        .from(trainingWatches)
        .innerJoin(
          trainingMaterials,
          and(
            eq(trainingMaterials.id, trainingWatches.materialId),
            eq(trainingMaterials.isInduction, true),
            eq(trainingMaterials.archived, false),
          ),
        )
        .groupBy(trainingWatches.employeeId),
    ]);

  const inductionTotal = inductionTotalRow[0]?.n ?? 0;
  const materialsTotal = materialTotalRow[0]?.n ?? 0;
  const watchedBy = new Map(watchRows.map((r) => [r.employeeId, r.n]));
  const learnedBy = new Map(learnRows.map((r) => [r.employeeId, r.minutes]));
  const sharedBy = new Set(shareRows.map((r) => r.employeeId));
  const inductionBy = new Map(inductionWatchRows.map((r) => [r.employeeId, r.n]));

  return people.map((p) => {
    const inductionDone = inductionBy.get(p.id) ?? 0;
    return {
      employeeId: p.id,
      employeeName: p.name,
      inductionDone,
      inductionTotal,
      inductionPct: inductionTotal > 0 ? Math.round((inductionDone / inductionTotal) * 100) : 0,
      selfLearningMinutes: learnedBy.get(p.id) ?? 0,
      selfLearningTarget: selfLearningTargetMin,
      sharedThisWeek: sharedBy.has(p.id),
      materialsWatched: watchedBy.get(p.id) ?? 0,
      materialsTotal,
    };
  });
}

/* ── Feedback (about sessions) ───────────────────────────────────────────── */

export interface SessionFeedbackRow {
  sessionId: string;
  sessionTitle: string;
  scheduledAt: Date;
  trainerName: string | null;
  avgRating: number | null;
  ratingCount: number;
  attendeeCount: number;
  /** The viewer's own rating + comment, when they've left one. */
  myRating: number | null;
  myComment: string | null;
  /** Whether the viewer was marked present — only attendees may rate. */
  iAttended: boolean;
}

export async function listSessionFeedback(viewerId: string): Promise<SessionFeedbackRow[]> {
  const trainer = alias(employees, "fb_trainer");
  const rows = await db
    .select({
      sessionId: trainingSessions.id,
      sessionTitle: trainingSessions.title,
      scheduledAt: trainingSessions.scheduledAt,
      trainerName: trainer.name,
      avgRating: sql<number | null>`(
        select round(avg(f.rating)::numeric, 1)::float8 from training_session_feedback f
         where f.session_id = ${trainingSessions.id}
      )`,
      ratingCount: sql<number>`(
        select count(*)::int from training_session_feedback f
         where f.session_id = ${trainingSessions.id}
      )`,
      attendeeCount: sql<number>`(
        select count(*)::int from training_session_attendance a
         where a.session_id = ${trainingSessions.id} and a.present
      )`,
      myRating: sql<number | null>`(
        select f.rating from training_session_feedback f
         where f.session_id = ${trainingSessions.id} and f.employee_id = ${viewerId}
      )`,
      myComment: sql<string | null>`(
        select f.comment from training_session_feedback f
         where f.session_id = ${trainingSessions.id} and f.employee_id = ${viewerId}
      )`,
      iAttended: sql<boolean>`exists (
        select 1 from training_session_attendance a
         where a.session_id = ${trainingSessions.id} and a.employee_id = ${viewerId} and a.present
      )`,
    })
    .from(trainingSessions)
    .leftJoin(trainer, eq(trainer.id, trainingSessions.trainerId))
    .where(
      and(
        eq(trainingSessions.cancelled, false),
        lte(trainingSessions.scheduledAt, new Date()),
      ),
    )
    .orderBy(desc(trainingSessions.scheduledAt))
    .limit(50);
  return rows.map((r) => ({ ...r, trainerName: r.trainerName ?? null }));
}

/** Every comment left on one session — shown to admins under each row. */
export async function listFeedbackComments(
  sessionIds: string[],
): Promise<Map<string, { name: string | null; rating: number; comment: string | null }[]>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({
      sessionId: trainingSessionFeedback.sessionId,
      name: employees.name,
      rating: trainingSessionFeedback.rating,
      comment: trainingSessionFeedback.comment,
    })
    .from(trainingSessionFeedback)
    .leftJoin(employees, eq(employees.id, trainingSessionFeedback.employeeId))
    .where(inArray(trainingSessionFeedback.sessionId, sessionIds))
    .orderBy(desc(trainingSessionFeedback.createdAt));

  const out = new Map<string, { name: string | null; rating: number; comment: string | null }[]>();
  for (const r of rows) {
    const list = out.get(r.sessionId) ?? [];
    list.push({ name: r.name ?? null, rating: r.rating, comment: r.comment });
    out.set(r.sessionId, list);
  }
  return out;
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

export interface TrainingDashboard {
  materials: number;
  induction: number;
  employees: number;
  watches: number;
  sessions: number;
  avgSessionRating: number | null;
  bySubject: { subject: string; n: number }[];
  /** Share of active staff who logged this week's share. */
  sharedThisWeek: number;
  activeStaff: number;
  /** Share of active staff who hit the monthly self-learning target. */
  hitLearningTarget: number;
}

export async function getTrainingDashboard(
  now: Date = new Date(),
): Promise<TrainingDashboard> {
  const obligations = await listObligations(now);
  const [matRow, indRow, empRow, watchRow, sessRow, ratingRow, subjectRows] =
    await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trainingMaterials)
        .where(eq(trainingMaterials.archived, false)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trainingMaterials)
        .where(
          and(eq(trainingMaterials.isInduction, true), eq(trainingMaterials.archived, false)),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(eq(employees.isActive, true)),
      db.select({ n: sql<number>`count(*)::int` }).from(trainingWatches),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(trainingSessions)
        .where(eq(trainingSessions.cancelled, false)),
      db
        .select({ avg: sql<number | null>`round(avg(rating)::numeric, 1)::float8` })
        .from(trainingSessionFeedback),
      db
        .select({
          subject: sql<string>`coalesce(nullif(trim(${trainingMaterials.subject}), ''), 'Unsorted')`,
          n: sql<number>`count(*)::int`,
        })
        .from(trainingMaterials)
        .where(eq(trainingMaterials.archived, false))
        .groupBy(sql`coalesce(nullif(trim(${trainingMaterials.subject}), ''), 'Unsorted')`)
        .orderBy(desc(sql`count(*)`)),
    ]);

  return {
    materials: matRow[0]?.n ?? 0,
    induction: indRow[0]?.n ?? 0,
    employees: empRow[0]?.n ?? 0,
    watches: watchRow[0]?.n ?? 0,
    sessions: sessRow[0]?.n ?? 0,
    avgSessionRating: ratingRow[0]?.avg ?? null,
    bySubject: subjectRows,
    sharedThisWeek: obligations.filter((o) => o.sharedThisWeek).length,
    activeStaff: obligations.length,
    hitLearningTarget: obligations.filter(
      (o) => o.selfLearningMinutes >= o.selfLearningTarget,
    ).length,
  };
}

/** Re-exported so pages don't each import the week helper. */
export { currentWeekStart, istYmd };
