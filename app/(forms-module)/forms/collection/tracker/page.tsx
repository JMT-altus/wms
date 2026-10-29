import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, personOf } from "@/lib/collections/derive";
import { loadCollectionParties } from "@/lib/collections/load";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { localDateString } from "@/lib/format";
import { getCollectionCapabilities, getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";
import { scorecardFor, type ScorecardView } from "@/lib/collections/scorecards";
import { salespersonIdentityFor } from "@/lib/collections/salesperson-identity";
import { escalationCountsForSalesperson } from "@/lib/queries/collection-scorecards";
import { getCurrentEmployee } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { FIELD_PERMISSIONS_HREF, buildSetupHints } from "@/lib/collections/setup-hints";
import { capabilityHolders } from "@/lib/queries/collection-setup";
import { latestConfirmations, openEscalations } from "@/lib/queries/collection-review";
import { listCoordinatorOptions } from "@/lib/queries/collection-master";

export const dynamic = "force-dynamic";

/**
 * Collection Tracker — company-wise follow-ups. Companies come from the
 * Collection Master; amounts and due dates only from an approved transaction
 * source (none yet, so none are shown). Follow-up dates and notes come from the
 * saved history.
 *
 * Needs collection.view, checked before anything is loaded. Each control is
 * shown according to its own capability; the server action checks it again.
 *
 * Holders of collection.escalation.review also get a link to the review queue,
 * with the count of open escalations. Super-admins — the only people who can
 * grant the sensitive capabilities — additionally see a "setup needed" notice
 * when escalations are waiting or parties are unassigned and nobody has been
 * granted the capability to handle them. Nothing is ever granted by code.
 */
export default async function CollectionTrackerPage() {
  await requireCollectionCapability("collection.view");
  const caps = await getCollectionCapabilities();
  const [source, followUps] = await Promise.all([loadCollectionParties(), listFollowUps()]);
  const companyIds = source.parties.map((p) => p.masterId).filter((id): id is string => !!id);
  // Confirmation (visible to every Tracker user) and open-escalation status, from
  // the database on every request — never from browser state.
  // Coordinator choices are read only for holders of collection.coordinator.assign.
  const [confirmations, escalations, coordinatorOptions] = await Promise.all([
    latestConfirmations(companyIds),
    openEscalations(companyIds),
    caps["collection.coordinator.assign"] ? listCoordinatorOptions() : null,
  ]);
  const rows = buildRows(source.parties, followUps.entries).map((r) => {
    const c = r.masterId ? confirmations.byCompany.get(r.masterId) : undefined;
    const e = r.masterId ? escalations.byCompany.get(r.masterId) : undefined;
    return {
      ...r,
      confirmation: c ? { value: c.value, recordedAt: c.recordedAt, recordedByName: c.recordedByName } : null,
      openEscalation: e ? { escalatedAt: e.escalatedAt, escalatedByName: e.escalatedByName } : null,
    };
  });

  // The signed-in employee's OWN scorecard only. Who they are as a salesperson comes from the verified
  // session through the super-admin-kept link (salespersonIdentityFor); without one, nothing is computed.
  // Outstanding only from an approved source (none yet → "not configured"); escalation figures only for
  // holders of collection.escalation.review, and only for this one salesperson's companies.
  // If the link can't be read, show the "not configured" state — never anyone's figures, and the Tracker still loads.
  const identity = await salespersonIdentityFor(await getCurrentEmployee()).catch(() => {
    console.error("[collection-scorecards] could not read the Sales Coordinator link");
    return { status: "unconfigured" } as const;
  });
  let scorecard: ScorecardView = identity.status === "not-salesperson" ? { status: "not-salesperson" } : { status: "unmapped" };
  if (identity.status === "linked") {
    const salesLabel = identity.label;
    const reviewer = await getCollectionCapability("collection.escalation.review");
    const own = reviewer
      ? await escalationCountsForSalesperson(reviewer, salesLabel).catch(() => {
          console.error("[collection-scorecards] could not count escalations");
          return "error" as const;
        })
      : null;
    scorecard = { status: "ok", card: scorecardFor(salesLabel, source.parties, source.transactions, own) };
  }

  const openEscalationCount = escalations.byCompany.size;
  const reviewQueue = caps["collection.escalation.review"] ? { openCount: openEscalationCount, href: "/forms/collection/commitments" } : undefined;
  // Super-admins only (the existing rule): what to grant, and where, when work is waiting for nobody.
  const me = await getCurrentEmployee();
  const setupHints =
    me && isSuperAdmin(me.email)
      ? buildSetupHints({
          openEscalations: openEscalationCount,
          unassignedParties: rows.filter((r) => r.masterId && personOf(r) === null).length,
          holders: await capabilityHolders(),
        })
      : [];

  return (
    <div>
      <header className="mb-4">
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          Collection Tracker
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Open a party to set its next follow-up date and keep date-wise notes.
        </p>
      </header>
      <CollectionTracker
        rows={rows}
        connected={source.connected}
        storageReady={followUps.storageReady}
        today={localDateString("Asia/Kolkata")}
        emptyMessage={source.message}
        transactionSource={source.transactions}
        // Yes/no flags only. Commitment figures are never part of this page's
        // data; the popup fetches them through a capability-checked action.
        canSeeCommitments={caps["collection.commitments.view"]}
        canEditCommitments={caps["collection.commitments.edit"]}
        canWriteFollowUps={caps["collection.followup.write"]}
        commentEditorId={caps["collection.followup.write"] ? (me?.id ?? null) : null}
        canSetConfirmation={caps["collection.confirmation.set"]}
        canEscalate={caps["collection.escalation.create"]}
        canImportBalances={caps["collection.balances.import"]}
        balancesProblem={source.balances?.status === "error" ? (source.balances.errorCode ?? "unknown") : undefined}
        reviewStorageReady={confirmations.storageReady && escalations.storageReady}
        coordinatorEditor={coordinatorOptions?.storageReady ? { options: coordinatorOptions.labels } : undefined}
        reviewQueue={reviewQueue}
        scorecard={scorecard}
        setupHints={setupHints.map((h) => ({ id: h.key, text: h.text }))}
        setupHref={setupHints.length > 0 ? FIELD_PERMISSIONS_HREF : undefined}
      />
    </div>
  );
}
