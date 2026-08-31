import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getDccScope, canFill, canManageItems, canReview } from "@/lib/dcc/access";
import {
  listOwnerItems,
  listOwnerEntries,
  listDccPeople,
  listReviewsForOwners,
  listOwnerClients,
  listOwnerSubjects,
  listItemSubjectsForItems,
  listOwnerSections,
} from "@/lib/queries/dcc";
import { DccBoard } from "@/components/dcc/dcc-board";
import { todayIso, addDays } from "@/lib/dcc/util";
import type { BoardItem } from "@/lib/dcc/board-model";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * How much history the board loads.
 *
 * The streak walks back 60 days and the trend strip shows 21, but the streak
 * stops at the first unfilled day — 48 days is comfortably past any realistic
 * run while keeping the payload small.
 */
const HISTORY_DAYS = 48;

export default async function DccPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();
  const scope = await getDccScope(me);

  // A manager may pass ?emp=, but only for someone actually in their scope —
  // an id from the query string is a request, not an authorisation.
  const requested = pick(sp.emp);
  const ownerId = requested && scope.visibleIds.has(requested) ? requested : me.id;

  const today = todayIso();
  const dateParam = pick(sp.date);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  const from = addDays(today, -HISTORY_DAYS);

  const [items, entries, people, reviews, clients, subjects, sections] = await Promise.all([
    listOwnerItems(ownerId),
    listOwnerEntries(ownerId, from),
    scope.isManager ? listDccPeople([...scope.visibleIds]) : Promise.resolve([]),
    listReviewsForOwners([ownerId], from),
    listOwnerClients(ownerId),
    listOwnerSubjects(ownerId),
    listOwnerSections(ownerId),
  ]);

  // Second wave: needs the item ids from the first.
  const itemSubjects = await listItemSubjectsForItems(items.map((i) => i.id));

  const ownerName =
    ownerId === me.id ? me.name : (people.find((p) => p.id === ownerId)?.name ?? "Teammate");
  const review = reviews.find((r) => r.reviewDate === date) ?? null;

  // Narrow the DB rows to the board's own shape so the client bundle never
  // sees columns it has no business with (created_by, timestamps, …).
  const boardItems: BoardItem[] = items.map((i) => ({
    id: i.id,
    section: i.section,
    code: i.code,
    title: i.title,
    frequency: i.frequency,
    weekdays: i.weekdays,
    scheduleKind: i.scheduleKind,
    isParticipantList: i.isParticipantList,
    clientId: i.clientId,
    needsReview: i.needsReview,
    targetNumber: i.targetNumber,
    unit: i.unit,
    sortOrder: i.sortOrder,
  }));

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[var(--max-content)] px-6 py-6 max-md:px-4">
        <h1
          className="text-display-md mb-1 text-ink-strong"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Daily Compliance Checklist
        </h1>
        <p className="mb-5 text-[13.5px] text-ink-subtle">
          Mark every KPI due today. Weekly, monthly and ad-hoc items sit in their own
          trays and never count against your day.
        </p>

        <DccBoard
          ownerId={ownerId}
          ownerName={ownerName}
          meId={me.id}
          date={date}
          items={boardItems}
          entries={entries.map((e) => ({
            itemId: e.itemId,
            entryDate: e.entryDate,
            status: e.status,
            valueNumber: e.valueNumber,
            note: e.note,
            subjectId: e.subjectId,
          }))}
          clients={clients.map((c) => ({
            id: c.id,
            section: c.section,
            name: c.name,
            sortOrder: c.sortOrder,
          }))}
          subjects={subjects.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            sortOrder: s.sortOrder,
          }))}
          itemSubjects={itemSubjects.map((l) => ({
            itemId: l.itemId,
            subjectId: l.subjectId,
            sortOrder: l.sortOrder,
          }))}
          people={people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))}
          review={review ? { status: review.status, note: review.note } : null}
          canFill={canFill(scope, ownerId)}
          canManage={canManageItems(scope, ownerId)}
          canReview={canReview(scope, ownerId)}
          isManager={scope.isManager}
          sections={sections}
        />
      </main>
      <DashboardFooter />
    </>
  );
}
