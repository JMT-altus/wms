import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows, personOf } from "@/lib/collections/derive";
import { loadCollectionParties } from "@/lib/collections/load";
import { scopeNote } from "@/lib/collections/scope";
import { collectionScopeFor } from "@/lib/collections/scope-server";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { localDateString } from "@/lib/format";
import { getCollectionCapabilities, getCollectionCapability, requireCollectionCapability } from "@/lib/auth/capability";
import { scorecardFor, type ScorecardView } from "@/lib/collections/scorecards";
import { salespersonIdentityFor, type SalespersonIdentity } from "@/lib/collections/salesperson-identity";
import { escalationCountsForSalesperson } from "@/lib/queries/collection-scorecards";
import { getCurrentEmployee } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { FIELD_PERMISSIONS_HREF, buildSetupHints } from "@/lib/collections/setup-hints";
import { capabilityHolders } from "@/lib/queries/collection-setup";
import { latestConfirmations, latestConfirmedAmounts, openEscalations } from "@/lib/queries/collection-review";
import { listCoordinatorOptions } from "@/lib/queries/collection-master";
import { latestCommitments } from "@/lib/queries/collection-commitments";
import { activeMarks } from "@/lib/queries/collection-marks";

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
 * Holders of collection.escalation.review who can also open the Commitments &
 * Escalations page (collection.commitments.page) get a link to the review
 * queue, with the count of open escalations. Super-admins — the only people who can
 * grant the sensitive capabilities — additionally see a "setup needed" notice
 * when escalations are waiting or parties are unassigned and nobody has been
 * granted the capability to handle them. Nothing is ever granted by code.
 */
export default async function CollectionTrackerPage() {
  const viewer = await requireCollectionCapability("collection.view");
  const caps = await getCollectionCapabilities();
  // The companies inside the signed-in person's scope (lib/collections/scope.ts):
  // every company for a super-admin, only their own for a linked Sales
  // Coordinator, none for anyone else — decided on the server from the session,
  // never from anything the browser sent. Companies in Collection Logs (₹0 Debit
  // and ₹0 Credit in the latest confirmed upload that included them) are left
  // out of the list; they stay in the Master with everything recorded, and the
  // next confirmed upload that gives them a balance brings them back.
  const scope = await collectionScopeFor();
  const [loaded, followUps] = await Promise.all([loadCollectionParties(scope), listFollowUps()]);
  const loggedCount = loaded.parties.filter((p) => p.inLogs).length;
  const active = loaded.parties.filter((p) => !p.inLogs);
  const source = { ...loaded, parties: active, connected: loaded.connected && (active.length > 0 || loggedCount > 0) };
  const companyIds = source.parties.map((p) => p.masterId).filter((id): id is string => !!id);
  // Confirmation (visible to every Tracker user) and open-escalation status, from
  // the database on every request — never from browser state.
  // Coordinator choices are read only for holders of collection.coordinator.assign.
  // The confirmed amount (the column's text field) is read beside the Yes/No answer; the two are separate values.
  // The commitment (amount – date) shown in the same column is restricted: it is read only with a proof of
  // collection.commitments.view, for the companies in this person's scope, and sent to nobody else.
  const commitmentViewer = caps["collection.commitments.view"] ? await getCollectionCapability("collection.commitments.view") : null;
  // The MARK AS PRIORITY / COLLECTION DONE marks (migration 0125) are visible to every Tracker user — they decide
  // the row's group and colour for everyone; only setting them needs the two mark capabilities.
  const [confirmations, confirmedAmounts, escalations, coordinatorOptions, commitments, marks] = await Promise.all([
    latestConfirmations(companyIds),
    latestConfirmedAmounts(companyIds),
    openEscalations(companyIds),
    caps["collection.coordinator.assign"] ? listCoordinatorOptions() : null,
    commitmentViewer ? latestCommitments(commitmentViewer, companyIds) : null,
    activeMarks(companyIds),
  ]);
  const rows = buildRows(source.parties, followUps.entries).map((r) => {
    const c = r.masterId ? confirmations.byCompany.get(r.masterId) : undefined;
    const a = r.masterId ? confirmedAmounts.byCompany.get(r.masterId) : undefined;
    const e = r.masterId ? escalations.byCompany.get(r.masterId) : undefined;
    const k = commitments && r.masterId ? commitments.byCompany.get(r.masterId) : undefined;
    return {
      ...r,
      ...(commitments ? { commitment: k ? { amount: k.amount, committedDate: k.committedDate, recordedAt: k.recordedAt, recordedByName: k.recordedByName } : null } : {}),
      confirmation: c ? { value: c.value, recordedAt: c.recordedAt, recordedByName: c.recordedByName } : null,
      confirmedAmount: a ? { amount: a.amount, recordedAt: a.recordedAt, recordedByName: a.recordedByName } : null,
      openEscalation: e ? { escalatedAt: e.escalatedAt, escalatedByName: e.escalatedByName } : null,
      marks: r.masterId ? (marks.byCompany.get(r.masterId) ?? null) : null,
    };
  });

  // The signed-in employee's OWN scorecard only. Who they are as a salesperson comes from the verified
  // session through the super-admin-kept link (salespersonIdentityFor); without one, nothing is computed.
  // Outstanding only from an approved source (none yet → "not configured"); escalation figures for this one
  // salesperson's companies, with the Tracker's own collection.view proof.
  // Each way the link can be absent is reported as itself: no link ("unmapped" — an admin can add one), the
  // link table not installed ("not-installed" — migration 0120 first), or a read failure ("unavailable" —
  // never shown as a missing link). In every case the Tracker still loads and nobody's figures are shown.
  let identity: SalespersonIdentity | { status: "unavailable" };
  try {
    identity = await salespersonIdentityFor(await getCurrentEmployee());
  } catch (err) {
    const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
    const code = typeof e?.cause?.code === "string" ? e.cause.code : typeof e?.code === "string" ? e.code : "unknown";
    console.error(`[collection-scorecards] could not read the Sales Coordinator link (SQLSTATE ${code})`);
    identity = { status: "unavailable" };
  }
  let scorecard: ScorecardView;
  if (identity.status === "linked") {
    const salesLabel = identity.label;
    const own = await escalationCountsForSalesperson(viewer, salesLabel).catch(() => {
      console.error("[collection-scorecards] could not count escalations");
      return "error" as const;
    });
    scorecard = { status: "ok", card: scorecardFor(salesLabel, source.parties, source.transactions, own) };
  } else {
    scorecard = identity.status === "unconfigured" ? { status: "unmapped" } : { status: identity.status };
  }

  // The Collection person filter's starting choice. A viewer who sees EVERY company (scope "all") but is themselves
  // linked to a Sales Coordinator label starts on their own label, so the Tracker opens on their own companies; the
  // dropdown still offers "All collection persons" and every other coordinator — the scope, not the filter, decides
  // what may be seen. A linked coordinator (scope "coordinator") already sees only their own companies, so nothing
  // changes for them; an all-scope viewer with no link starts on everyone, as before. The label comes from the
  // super-admin-kept link, never from a name or an email address.
  const defaultCollectionPerson = scope.kind === "all" && identity.status === "linked" ? identity.label : undefined;

  const openEscalationCount = escalations.byCompany.size;
  // The review queue is the Escalations page, which every reviewer may open.
  const reviewQueue = caps["collection.escalation.review"] ? { openCount: openEscalationCount, href: "/collection/escalations" } : undefined;
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
        scopeNote={scopeNote(scope) ?? undefined}
        defaultCollectionPerson={defaultCollectionPerson}
        logsNote={loggedCount > 0 ? { count: loggedCount, href: caps["collection.logs.view"] ? "/collection/logs" : null } : undefined}
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
        canAddMasterCompanies={caps["collection.master.import"]}
        canSetPriority={caps["collection.priority.set"]}
        canSetDone={caps["collection.done.set"]}
        marksStorageReady={marks.storageReady}
        balancesProblem={source.balances?.status === "error" ? (source.balances.errorCode ?? "unknown") : undefined}
        reviewStorageReady={confirmations.storageReady && escalations.storageReady}
        amountStorageReady={confirmedAmounts.storageReady}
        coordinatorEditor={coordinatorOptions?.storageReady ? { options: coordinatorOptions.labels } : undefined}
        reviewQueue={reviewQueue}
        scorecard={scorecard}
        setupHints={setupHints.map((h) => ({ id: h.key, text: h.text }))}
        setupHref={setupHints.length > 0 ? FIELD_PERMISSIONS_HREF : undefined}
      />
    </div>
  );
}
