import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCollectionCapability } from "@/lib/auth/capability";
import { listOwnerCommitments } from "@/lib/queries/collection-commitments";
import { CommitmentsTable } from "@/components/collections/commitments-table";
import { buildReviewRows } from "@/lib/collections/review-rows";
import { localDateString } from "@/lib/format";

/**
 * Collection Commitments — every company with a recorded commitment: its
 * committed amount and date, collection person (Sales Coordinator), Collection
 * Amount Confirmation, the outstanding amount when the approved transaction
 * source supplies one, due dates with the Tracker's overdue colouring, and its
 * Tracker comments. Escalations have their own page (/collection/escalations);
 * nothing about them is read or shown here.
 *
 * Opening the page needs collection.commitments.page (its own explicit grant —
 * the company popup's Commitment section keys never open it, and it never opens
 * them). The commitments themselves need collection.commitments.view and are
 * read only with that proof. Recording a commitment stays in the company popup
 * (collection.commitments.edit, checked by its action).
 *
 * Rendered per request. Capabilities are checked on the server from the signed
 * session before any data is read; someone without page access gets a plain
 * "not found", so the page doesn't even confirm it exists.
 */
export const dynamic = "force-dynamic";

const NOTICE = { background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" } as const;

export default async function CollectionCommitmentsPage() {
  // The page's own gate comes first: without it nothing below is read.
  if (!(await getCollectionCapability("collection.commitments.page"))) notFound();
  const viewer = await getCollectionCapability("collection.commitments.view");

  const data = await (viewer ? listOwnerCommitments(viewer) : Promise.resolve({ storageReady: true, rows: [] })).catch(() => null);
  const built = data ? await buildReviewRows({ commitments: data.rows, escalations: [] }) : null;
  if (!data || !built) {
    console.error("[collection-commitments] could not load the commitments page");
    return (
      <PageShell canView={viewer !== null}>
        <LoadError />
      </PageShell>
    );
  }

  const notices = [
    !viewer && "You can open this page, but seeing commitments needs the company popup's \"Commitment Section: View\" permission. Ask an administrator (Field Permissions).",
    !data.storageReady && "Commitment storage isn't set up yet (migration 0114 is pending).",
    !built.followUpsReady && "Tracker comments aren't available yet (follow-up storage, migration 0110, is pending).",
  ].filter((n): n is string => Boolean(n));

  return (
    <PageShell canView={viewer !== null}>
      {notices.map((n) => (
        <p key={n} role="status" className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={NOTICE}>
          {n}
        </p>
      ))}
      <CommitmentsTable
        rows={built.rows}
        today={localDateString("Asia/Kolkata")}
        showCommitments={viewer !== null}
        showEscalations={false}
        canClose={false}
        emptyMessage="No commitments recorded yet. Record one from a party's popup in the Collection Tracker."
      />
    </PageShell>
  );
}

function PageShell({ canView, children }: { canView: boolean; children: ReactNode }) {
  return (
    <div>
      <header className="mb-4">
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          Collection Commitments
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Recorded commitments, with the reporting collection person, confirmation, due dates and Tracker comments. Visible only to people granted access.
          {canView ? " Record a commitment from the company's popup in the Collection Tracker." : ""}
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
