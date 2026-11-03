import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCollectionCapabilities, getCollectionCapability } from "@/lib/auth/capability";
import { listOpenEscalationsForReview } from "@/lib/queries/collection-review";
import { CommitmentsTable } from "@/components/collections/commitments-table";
import { buildReviewRows } from "@/lib/collections/review-rows";
import { localDateString } from "@/lib/format";

/**
 * Collection Escalations — every company escalated for review and still open:
 * who escalated it and when, the Reason for Escalation, the Collection Amount
 * Confirmation and confirmed amount at the time, the collection person (Sales
 * Coordinator), due dates and Tracker comments. Commitments have their own page
 * (/collection/commitments); no commitment is read or shown here.
 *
 * Opening the page needs collection.escalation.review — every holder is a
 * reviewer (nobody is named) — checked on the server from the signed session
 * before anything is read; without it the page is a plain "not found". The
 * escalations are read only with that proof. Closing one needs
 * collection.escalation.close: the Close button shows only with it, and the
 * close action checks it again.
 */
export const dynamic = "force-dynamic";

const NOTICE = { background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" } as const;

export default async function CollectionEscalationsPage() {
  const reviewer = await getCollectionCapability("collection.escalation.review");
  if (!reviewer) notFound();
  const caps = await getCollectionCapabilities();

  const escalations = await listOpenEscalationsForReview(reviewer).catch(() => null);
  const built = escalations ? await buildReviewRows({ commitments: [], escalations: escalations.rows }) : null;
  if (!escalations || !built) {
    console.error("[collection-escalations] could not load the escalations page");
    return (
      <PageShell>
        <LoadError />
      </PageShell>
    );
  }

  const notices = [
    !escalations.storageReady && "Escalation and confirmation storage isn't set up yet (migration 0115 is pending).",
    escalations.storageReady && !escalations.reasonStorageReady && "Escalation reasons aren't available yet (migration 0118 is pending).",
    !built.followUpsReady && "Tracker comments aren't available yet (follow-up storage, migration 0110, is pending).",
  ].filter((n): n is string => Boolean(n));

  return (
    <PageShell>
      {notices.map((n) => (
        <p key={n} role="status" className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={NOTICE}>
          {n}
        </p>
      ))}
      <CommitmentsTable
        rows={built.rows}
        today={localDateString("Asia/Kolkata")}
        showCommitments={false}
        showEscalations
        canClose={caps["collection.escalation.close"]}
        // Every reviewer may answer an escalation; the action checks collection.escalation.review again.
        canComment
        emptyMessage="No escalations are waiting for review. When someone escalates a party from the Collection Tracker, it appears here."
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div>
      <header className="mb-4">
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          Collection Escalations
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Companies escalated for review, with the reason, the reporting collection person, confirmation, due dates and Tracker comments. Visible only to people granted access.
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
