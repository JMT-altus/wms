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
import { DccGrid } from "@/components/dcc/dcc-grid";
import { DccTabs } from "@/components/dcc/dcc-tabs";
import { todayIso, addDays } from "@/lib/dcc/util";
import { toBoardItem } from "@/lib/dcc/board-model";
import { gridWeeks, monthStart, weekStart } from "@/lib/dcc/grid-model";
import { dccInputTypeReady } from "@/lib/dcc/schema-ready";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How much history the day board loads.
 *
 * The streak walks back 60 days and the trend strip shows 21, but the streak
 * stops at the first unfilled day — 48 days is comfortably past any realistic
 * run while keeping the payload small.
 */
const HISTORY_DAYS = 48;
/** Weeks on the sheet at once: the week shown and the three before it. */
const WEEKS_SHOWN = 4;

/**
 * /dcc — one person's checklist.
 *
 *   ?emp=    whose (honoured only inside the viewer's scope; defaults to self)
 *   ?view=   "grid" (the sheet, default) or "day" (the day board)
 *   ?week=   any date in the last week the grid shows (default: this week)
 *   ?date=   the day the day board shows (default: today)
 */
export default async function DccPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();
  const scope = await getDccScope(me);

  // A manager may pass ?emp=, but only for someone actually in their scope —
  // an id from the query string is a request, not an authorisation.
  const requested = pick(sp.emp);
  const ownerId = requested && scope.visibleIds.has(requested) ? requested : me.id;

  const view = pick(sp.view) === "day" ? "day" : "grid";
  const today = todayIso();
  const dateParam = pick(sp.date);
  const date = dateParam && YMD.test(dateParam) ? dateParam : today;
  const weekParam = pick(sp.week);
  const anchor = weekStart(weekParam && YMD.test(weekParam) ? weekParam : today);
  const weeks = gridWeeks(anchor, WEEKS_SHOWN);
  // Enough history for the day board's streak AND for every week (and the
  // month a monthly cell lives in) the grid shows.
  const from = [addDays(today, -HISTORY_DAYS), weeks[0]!.monday, monthStart(weeks[0]!.monday)].sort()[0]!;

  const [items, entries, people, reviews, clients, subjects, sections, schemaReady] = await Promise.all([
    listOwnerItems(ownerId),
    listOwnerEntries(ownerId, from),
    listDccPeople([...scope.visibleIds]),
    listReviewsForOwners([ownerId], from),
    listOwnerClients(ownerId),
    listOwnerSubjects(ownerId),
    listOwnerSections(ownerId),
    dccInputTypeReady(),
  ]);

  // Second wave: needs the item ids from the first.
  const itemSubjects = await listItemSubjectsForItems(items.map((i) => i.id));

  const owner = people.find((p) => p.id === ownerId);
  const ownerName = owner?.name ?? (ownerId === me.id ? me.name : "Teammate");
  const ownerSub = owner ? [owner.designation, owner.department].filter(Boolean).join(" · ") || null : null;
  const review = reviews.find((r) => r.reviewDate === date) ?? null;

  // Narrow the DB rows to the board's own shape so the client bundle never
  // sees columns it has no business with (created_by, timestamps, …).
  const boardItems = items.map(toBoardItem);
  const boardEntries = entries.map((e) => ({
    itemId: e.itemId,
    entryDate: e.entryDate,
    status: e.status,
    valueNumber: e.valueNumber,
    note: e.note,
    subjectId: e.subjectId,
  }));
  const boardClients = clients.map((c) => ({ id: c.id, section: c.section, name: c.name, sortOrder: c.sortOrder }));

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[var(--max-content)] px-6 py-6 max-md:px-4">
        <h1 className="text-display-md mb-1 text-ink-strong" style={{ fontFamily: "var(--font-serif)" }}>
          Daily Compliance Checklist
        </h1>
        <p className="mb-4 text-[13.5px] text-ink-subtle">
          {view === "grid"
            ? "Each employee's KPI parameters, week by week. Fill a cell and it saves on its own; Weekly Actual and Deficit update as you go."
            : "Mark every KPI due today. Weekly, monthly and ad-hoc items sit in their own trays and never count against your day."}
        </p>

        <div className="mb-4">
          <DccTabs
            people={people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, department: p.department }))}
            meId={me.id}
            active={ownerId}
            showDashboard={scope.isManager}
            query={view === "grid" ? `view=grid&week=${anchor}` : `view=day&date=${date}`}
          />
        </div>

        {!schemaReady && canManageItems(scope, ownerId) && (
          <p className="mb-3 rounded-[12px] border px-3 py-2 text-[12.5px]" style={{ background: "var(--color-amber-bg)", borderColor: "var(--color-amber)", color: "var(--color-amber-deep)" }}>
            Answer types (Number / Text) and target periods arrive with database migration 0124, which is not installed yet. Until then every KPI is answered Yes / No.
          </p>
        )}
        {view === "grid" ? (
          <DccGrid
            ownerId={ownerId}
            ownerName={ownerName}
            ownerSub={ownerSub}
            meId={me.id}
            today={today}
            anchor={anchor}
            weeks={weeks}
            items={boardItems}
            entries={boardEntries}
            clients={boardClients}
            sections={sections}
            people={people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, department: p.department }))}
            canFill={canFill(scope, ownerId)}
            canManage={canManageItems(scope, ownerId)}
          />
        ) : (
          <DccBoard
            ownerId={ownerId}
            ownerName={ownerName}
            meId={me.id}
            date={date}
            items={boardItems}
            entries={boardEntries}
            clients={boardClients}
            subjects={subjects.map((s) => ({ id: s.id, name: s.name, kind: s.kind, sortOrder: s.sortOrder }))}
            itemSubjects={itemSubjects.map((l) => ({ itemId: l.itemId, subjectId: l.subjectId, sortOrder: l.sortOrder }))}
            people={people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))}
            review={review ? { status: review.status, note: review.note } : null}
            canFill={canFill(scope, ownerId)}
            canManage={canManageItems(scope, ownerId)}
            canReview={canReview(scope, ownerId)}
            isManager={scope.isManager}
            sections={sections}
          />
        )}
      </main>
      <DashboardFooter />
    </>
  );
}
