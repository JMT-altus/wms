import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { commentDate, commentTime } from "@/lib/collections/comment-audit";
import { formatInrExact } from "@/lib/collections/money";
import { CommentAudit, type CommentEntry } from "@/components/collections/comment-list";
import type { ClosureRow, CommitmentHistoryRow, ConfirmationHistoryRow, EscalationHistoryRow } from "@/lib/queries/collection-closures";

/**
 * Collection Logs — READ-ONLY views of closure episodes (migration 0119) and the
 * history a company already has. There is no close, reopen, edit or delete
 * control anywhere here, on purpose: closure is not built yet, and the history
 * shown is exactly what is stored.
 *
 * Times are shown in IST (the same "27-Oct-2026 · 01:35 PM IST" format as
 * Collection comments); money is shown exactly as stored, never rounded.
 */

export const CLOSE_REASON_LABEL: Record<ClosureRow["closeReason"], string> = {
  outstanding_zero: "Outstanding reached zero",
};
export const REOPEN_REASON_LABEL: Record<NonNullable<ClosureRow["reopenReason"]>, string> = {
  outstanding_positive: "Outstanding became positive again",
};

export const LOGS_EMPTY_MESSAGE =
  "No collection has been closed yet. Companies appear here once their collection is closed; automatic closure waits for an approved outstanding-balance source, so nothing is closed today.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const NOTICE = { background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" } as const;

/** "27-Oct-2026 · 01:35 PM IST" for a stored timestamp. */
export const istDateTime = (d: Date): string => `${commentDate(d)} · ${commentTime(d)}`;

/** A calendar date as stored ("2026-10-27" → "27-Oct-2026") — no timezone shift. */
export function calendarDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : iso;
}

/** Exact rupees from stored numeric text, keeping a sign the source wrote. */
export function exactAmount(text: string): string {
  const t = text.trim();
  return t.startsWith("-") ? `-${formatInrExact(t.slice(1))}` : formatInrExact(t);
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={NOTICE}>
      {children}
    </p>
  );
}

function StatusBadge({ row }: { row: Pick<ClosureRow, "reopenedAt"> }) {
  const open = row.reopenedAt === null;
  return (
    <span
      data-closure-status={open ? "closed" : "reopened"}
      className="inline-flex rounded-pill px-2 py-0.5 text-[11.5px] font-bold"
      style={open ? { background: "#ECFDF5", color: "#047857" } : { background: "#EFF6FF", color: "#1D4ED8" }}
    >
      {open ? "Closed" : "Reopened"}
    </span>
  );
}

function Source({ sourceKey, sourceRef }: { sourceKey: string; sourceRef: string | null }) {
  return (
    <span className="block">
      <span className="font-mono text-[12px] text-ink-soft">{sourceKey}</span>
      {sourceRef && <span className="block break-all font-mono text-[11.5px] text-ink-subtle">{sourceRef}</span>}
    </span>
  );
}

const TH = "px-3 py-2 text-left text-[11.5px] font-bold uppercase tracking-wide text-ink-subtle";
const TD = "px-3 py-2 align-top text-[13px] text-ink-strong";

/** Every closure episode, newest first. Read-only. */
export function CollectionLogsList({ rows, storageReady }: { rows: ClosureRow[]; storageReady: boolean }) {
  return (
    <div>
      {!storageReady && <Notice>Collection Logs storage isn&apos;t set up yet (migration 0119 is pending). Nothing has been closed.</Notice>}
      {rows.length === 0 ? (
        <p data-logs-empty className="rounded-lg border border-hairline bg-white px-4 py-6 text-center text-[13.5px] text-ink-subtle">
          {LOGS_EMPTY_MESSAGE}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="border-b border-hairline">
              <tr>
                <th className={TH}>Company</th>
                <th className={TH}>Closed (IST)</th>
                <th className={TH}>Reason</th>
                <th className={`${TH} text-right`}>Final outstanding</th>
                <th className={TH}>Source</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-closure-id={r.id} className="border-b border-hairline last:border-b-0">
                  <td className={TD}>
                    <Link href={`/forms/collection/logs/${r.id}` as Route} className="font-semibold text-ink-strong underline-offset-2 hover:underline">
                      {r.companyName}
                    </Link>
                    {r.collectionPerson && <span className="block text-[11.5px] text-ink-subtle">{r.collectionPerson}</span>}
                  </td>
                  <td className={`${TD} tabular-nums`}>{istDateTime(r.closedAt)}</td>
                  <td className={TD}>{CLOSE_REASON_LABEL[r.closeReason] ?? r.closeReason}</td>
                  <td className={`${TD} text-right tabular-nums`}>{exactAmount(r.finalOutstanding)}</td>
                  <td className={TD}>
                    <Source sourceKey={r.closeSourceKey} sourceRef={r.closeSourceRef} />
                  </td>
                  <td className={TD}>
                    <StatusBadge row={r} />
                    {r.reopenedAt && <span className="block text-[11.5px] tabular-nums text-ink-subtle">{istDateTime(r.reopenedAt)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section data-log-section={testId} className="mb-4 rounded-lg border border-hairline bg-white px-4 py-3">
      <h2 className="mb-2 text-[14px] font-bold text-ink-strong">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-[13px] text-ink-subtle">{children}</p>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-ink-strong">{children}</dd>
    </>
  );
}

/**
 * Each history part is passed only when the viewer holds ITS capability; a part
 * left `null` is not rendered at all (not even as "hidden"), so the log never
 * reveals restricted history. Collection Logs adds no access of its own.
 */
export interface LogHistory {
  comments: { storageReady: boolean; entries: CommentEntry[] } | null;
  confirmations: { storageReady: boolean; rows: ConfirmationHistoryRow[] } | null;
  commitments: { storageReady: boolean; rows: CommitmentHistoryRow[] } | null;
  escalations: { storageReady: boolean; reasonStorageReady: boolean; rows: EscalationHistoryRow[] } | null;
}

const by = (name: string | null) => name ?? "Unavailable";
const CONFIRMATION_LABEL = { yes: "Yes", no: "No" } as const;

/** One closure episode and the company's existing history. Read-only. */
export function CollectionLogDetail({ closure, episodes, history }: { closure: ClosureRow; episodes: ClosureRow[]; history: LogHistory }) {
  const { comments, confirmations, commitments, escalations } = history;
  return (
    <div>
      <Section title="Closure" testId="closure">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <Field label="Company">{closure.companyName}</Field>
          <Field label="Collection person">{closure.collectionPerson ?? "Unassigned"}</Field>
          <Field label="Status">
            <StatusBadge row={closure} />
          </Field>
          <Field label="Closed">
            <span className="tabular-nums">{istDateTime(closure.closedAt)}</span>
          </Field>
          <Field label="Reason">{CLOSE_REASON_LABEL[closure.closeReason] ?? closure.closeReason}</Field>
          <Field label="Final outstanding">
            <span className="tabular-nums">{exactAmount(closure.finalOutstanding)}</span>
          </Field>
          {closure.finalDebit !== null && (
            <Field label="Final debit">
              <span className="tabular-nums">{exactAmount(closure.finalDebit)}</span>
            </Field>
          )}
          {closure.finalCredit !== null && (
            <Field label="Final credit">
              <span className="tabular-nums">{exactAmount(closure.finalCredit)}</span>
            </Field>
          )}
          {closure.asOfDate && <Field label="As of">{calendarDate(closure.asOfDate)}</Field>}
          <Field label="Source">
            <Source sourceKey={closure.closeSourceKey} sourceRef={closure.closeSourceRef} />
          </Field>
          <Field label="Closed by">{closure.closedByName ?? "Not recorded (automatic, or the employee record was removed)"}</Field>
          {closure.reopenedAt && (
            <>
              <Field label="Reopened">
                <span className="tabular-nums">{istDateTime(closure.reopenedAt)}</span>
              </Field>
              <Field label="Reopen reason">{closure.reopenReason ? (REOPEN_REASON_LABEL[closure.reopenReason] ?? closure.reopenReason) : "—"}</Field>
              {closure.reopenSourceRef && (
                <Field label="Reopen source">
                  <span className="break-all font-mono text-[12px]">{closure.reopenSourceRef}</span>
                </Field>
              )}
              <Field label="Reopened by">{closure.reopenedByName ?? "Not recorded (automatic, or the employee record was removed)"}</Field>
            </>
          )}
        </dl>
      </Section>

      {episodes.length > 1 && (
        <Section title="All closures of this company" testId="episodes">
          <ul className="text-[13px]">
            {episodes.map((e) => (
              <li key={e.id} className="border-b border-hairline py-1 last:border-b-0">
                {e.id === closure.id ? (
                  <span className="font-semibold">{istDateTime(e.closedAt)} (this one)</span>
                ) : (
                  <Link href={`/forms/collection/logs/${e.id}` as Route} className="underline-offset-2 hover:underline">
                    {istDateTime(e.closedAt)}
                  </Link>
                )}{" "}
                <StatusBadge row={e} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {comments && (
        <Section title="Comments & follow-ups" testId="comments">
          {!comments.storageReady ? (
            <Empty>Tracker comments aren&apos;t available yet (follow-up storage, migration 0110, is pending).</Empty>
          ) : comments.entries.length === 0 ? (
            <Empty>No comments recorded.</Empty>
          ) : (
            comments.entries.map((c) => <CommentAudit key={c.id} entry={c} />)
          )}
        </Section>
      )}

      {confirmations && (
        <Section title="Collection Amount Confirmations" testId="confirmations">
          {!confirmations.storageReady ? (
            <Empty>Confirmation storage isn&apos;t set up yet (migration 0115 is pending).</Empty>
          ) : confirmations.rows.length === 0 ? (
            <Empty>No confirmation recorded.</Empty>
          ) : (
            <ul className="text-[13px]">
              {confirmations.rows.map((c) => (
                <li key={c.id} className="border-b border-hairline py-1 last:border-b-0">
                  <span className="font-semibold">{CONFIRMATION_LABEL[c.value] ?? c.value}</span>
                  <span className="text-ink-subtle">
                    {" "}
                    · by {by(c.recordedByName)} · <span className="tabular-nums">{istDateTime(c.recordedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {commitments && (
        <Section title="Commitments" testId="commitments">
          {!commitments.storageReady ? (
            <Empty>Commitment storage isn&apos;t set up yet (migration 0114 is pending).</Empty>
          ) : commitments.rows.length === 0 ? (
            <Empty>No commitments recorded.</Empty>
          ) : (
            <ul className="text-[13px]">
              {commitments.rows.map((c) => (
                <li key={c.id} className="border-b border-hairline py-1 last:border-b-0">
                  <span className="font-semibold tabular-nums">{exactAmount(c.amount)}</span> by{" "}
                  <span className="tabular-nums">{calendarDate(c.committedDate)}</span>
                  <span className="text-ink-subtle">
                    {" "}
                    · recorded by {by(c.recordedByName)} · <span className="tabular-nums">{istDateTime(c.recordedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {escalations && (
        <Section title="Escalations" testId="escalations">
          {!escalations.storageReady ? (
            <Empty>Escalation storage isn&apos;t set up yet (migration 0115 is pending).</Empty>
          ) : escalations.rows.length === 0 ? (
            <Empty>No escalations recorded.</Empty>
          ) : (
            <>
              {!escalations.reasonStorageReady && <Notice>Escalation reasons aren&apos;t available yet (migration 0118 is pending).</Notice>}
              <ul className="text-[13px]">
                {escalations.rows.map((e) => (
                  <li key={e.id} data-escalation-status={e.status} className="border-b border-hairline py-1.5 last:border-b-0">
                    <span className="font-semibold">{e.status === "open" ? "Open" : "Closed"}</span>
                    <span className="text-ink-subtle">
                      {" "}
                      · Escalated by: {by(e.escalatedByName)} · <span className="tabular-nums">{istDateTime(e.escalatedAt)}</span>
                      {" · "}Confirmation then: {e.confirmationAtEscalation ? CONFIRMATION_LABEL[e.confirmationAtEscalation] : "Not set"}
                    </span>
                    {e.closedAt && (
                      <span className="block text-[12px] text-ink-subtle">
                        Closed by: {by(e.closedByName)} · <span className="tabular-nums">{istDateTime(e.closedAt)}</span>
                      </span>
                    )}
                    {escalations.reasonStorageReady && (
                      <span className="block whitespace-pre-wrap">
                        <span className="text-ink-subtle">Reason for Escalation: </span>
                        {e.reason ?? <span className="italic text-ink-subtle">No reason recorded (raised before reasons were required)</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

/** The page frame shared by the list and the detail page. */
export function LogsShell({ title = "Collection Logs", back = false, children }: { title?: string; back?: boolean; children: ReactNode }) {
  return (
    <div>
      <header className="mb-4">
        {back && (
          <Link href={"/forms/collection/logs" as Route} className="mb-1 inline-block text-[12.5px] font-semibold text-ink-subtle underline-offset-2 hover:underline">
            ← Collection Logs
          </Link>
        )}
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          {title}
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Companies whose collection was closed, and their history. Read-only — nothing here changes any record.
        </p>
      </header>
      {children}
    </div>
  );
}

export function LogsLoadError() {
  return (
    <p role="alert" className="rounded-lg px-3 py-3 text-[13.5px] font-semibold" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" }}>
      This page could not be loaded. Nothing has been changed — please reload in a moment. If it keeps happening, tell an administrator.
    </p>
  );
}
