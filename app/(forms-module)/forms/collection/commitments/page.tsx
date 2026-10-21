import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCollectionCapabilities, getCollectionCapability } from "@/lib/auth/capability";
import { listOwnerCommitments } from "@/lib/queries/collection-commitments";
import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { latestConfirmations, listOpenEscalationsForReview } from "@/lib/queries/collection-review";
import { commentsOf, followUpsByParty, partyKey } from "@/lib/collections/derive";
import { loadCollectionParties, loadTransactionsByMaster } from "@/lib/collections/load";
import { localDateString } from "@/lib/format";

/**
 * Collection commitments and escalations. Commitments need
 * collection.commitments.view; open escalations need collection.escalation.review
 * (every holder is a reviewer — nobody is named); closing needs
 * collection.escalation.close. Each part is loaded only with its capability.
 * Every company with a recorded commitment OR an open escalation, with its
 * collection person (Sales Coordinator), Collection Amount Confirmation, the
 * outstanding amount when the approved transaction source supplies one, due
 * dates with the Tracker's overdue colouring, and its Tracker comments (matched
 * to the company by the Tracker's own rule, most recent first). An escalation is
 * shown as such; it never carries an invented commitment amount or date.
 *
 * Rendered per request (never pre-rendered or cached). Capabilities are checked
 * on the server from the signed session before any data is read; someone with
 * neither viewing capability gets a plain "not found", so the page doesn't even
 * confirm it exists.
 */
export const dynamic = "force-dynamic";

const NOTICE = { background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" } as const;

export default async function CollectionCommitmentsPage() {
  const [viewer, reviewer] = await Promise.all([
    getCollectionCapability("collection.commitments.view"),
    getCollectionCapability("collection.escalation.review"),
  ]);
  if (!viewer && !reviewer) notFound();
  const caps = await getCollectionCapabilities();
  // A failed load shows a clear message here instead of a crash page; a missing table is already
  // reported as "storage not set up" by the loaders themselves. Details are never shown or logged.
  const loaded = await Promise.all([
    viewer ? listOwnerCommitments(viewer) : { storageReady: true, rows: [] },
    reviewer ? listOpenEscalationsForReview(reviewer) : { storageReady: true, rows: [] },
    listFollowUps(),
    loadCollectionParties(),
  ]).catch(() => {
    console.error("[collection-review] could not load the review page");
    return null;
  });
  if (!loaded) {
    return (
      <PageShell viewer={viewer !== null} reviewer={reviewer !== null}>
        <LoadError />
      </PageShell>
    );
  }
  const [data, escalations, followUps, source] = loaded;

  // Commitments first (by committed date), then companies that are only escalated (oldest first).
  const base = new Map<string, Pick<CommitmentView, "companyId" | "companyName" | "collectionPerson" | "amount" | "committedDate" | "recordedAt">>();
  for (const r of data.rows) base.set(r.companyId, r);
  for (const e of escalations.rows) {
    if (!base.has(e.companyId)) {
      base.set(e.companyId, { companyId: e.companyId, companyName: e.companyName, collectionPerson: e.collectionPerson, amount: null, committedDate: null, recordedAt: null });
    }
  }
  const ids = [...base.keys()];
  const openByCompany = new Map(escalations.rows.map((e) => [e.companyId, e]));
  const outstandingByCompany = new Map(source.parties.filter((p) => p.masterId).map((p) => [p.masterId!, p.outstanding]));
  const byParty = followUpsByParty(followUps.entries);
  // Due dates for the overdue colouring: the same transaction source and company
  // id the Collection Tracker uses (none approved yet → no colour, nothing invented).
  const details = await Promise.all([latestConfirmations(ids), loadTransactionsByMaster(ids)]).catch(() => {
    console.error("[collection-review] could not load escalation details");
    return null;
  });
  if (!details) {
    return (
      <PageShell viewer={viewer !== null} reviewer={reviewer !== null}>
        <LoadError />
      </PageShell>
    );
  }
  const [confirmations, dueByCompany] = details;

  const rows: CommitmentView[] = ids.map((id) => {
    const r = base.get(id)!;
    const e = openByCompany.get(id);
    return {
      ...r,
      // Only what the comments column shows — the note, when, and by whom.
      comments: commentsOf(byParty.get(partyKey(r.companyName)) ?? []).map((h) => ({
        id: h.id,
        note: h.note,
        createdAt: h.createdAt,
        createdByName: h.createdByName,
      })),
      // Only what the overdue rule reads — not invoice references or amounts.
      due: (dueByCompany.get(id) ?? []).map((t) => ({ dueDate: t.dueDate, status: t.status, outstanding: t.outstanding })),
      confirmation: confirmations.byCompany.get(id)?.value ?? null,
      outstanding: outstandingByCompany.get(id) ?? null,
      escalation: e ? { id: e.id, escalatedAt: e.escalatedAt, escalatedByName: e.escalatedByName, confirmationAtEscalation: e.confirmationAtEscalation } : null,
    };
  });

  const notices = [
    !data.storageReady && "Commitment storage isn't set up yet (migration 0114 is pending).",
    !escalations.storageReady && "Escalation and confirmation storage isn't set up yet (migration 0115 is pending).",
    !followUps.storageReady && "Tracker comments aren't available yet (follow-up storage, migration 0110, is pending).",
  ].filter((n): n is string => Boolean(n));

  return (
    <PageShell viewer={viewer !== null} reviewer={reviewer !== null} commitmentsHelp={viewer !== null}>
      {notices.map((n) => (
        <p key={n} role="status" className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={NOTICE}>
          {n}
        </p>
      ))}
      <CommitmentsTable
        rows={rows}
        today={localDateString("Asia/Kolkata")}
        showCommitments={viewer !== null}
        showEscalations={reviewer !== null}
        canClose={caps["collection.escalation.close"]}
        emptyMessage={
          reviewer && !viewer
            ? "No escalations are waiting for review. When someone escalates a party from the Collection Tracker, it appears here."
            : viewer && !reviewer
              ? "No commitments recorded yet. Record one from a party's popup in the Collection Tracker."
              : "No commitments or open escalations yet."
        }
      />
    </PageShell>
  );
}

function PageShell({ viewer, reviewer, commitmentsHelp = false, children }: { viewer: boolean; reviewer: boolean; commitmentsHelp?: boolean; children: ReactNode }) {
  return (
    <div>
      <header className="mb-4">
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          {viewer && reviewer ? "Collection Commitments & Escalations" : viewer ? "Collection Commitments" : "Collection Escalations"}
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          {viewer ? "Recorded commitments" : ""}
          {viewer && reviewer ? " and " : ""}
          {reviewer ? (viewer ? "companies escalated for review" : "Companies escalated for review") : ""}, with the reporting collection person,
          confirmation, due dates and Tracker comments. Visible only to people granted access.
          {commitmentsHelp ? " Record a commitment from the company's popup in the Collection Tracker." : ""}
        </p>
      </header>
      {children}
    </div>
  );
}

function LoadError() {
  return (
    <p role="alert" className="rounded-lg px-3 py-3 text-[13.5px] font-semibold" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" }}>
      This page could not be loaded. Nothing has been changed — please reload in a moment. If it keeps happening, tell an administrator.
    </p>
  );
}
