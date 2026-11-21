"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { acknowledgeCategoryAHold, decideCategoryANegativeDecision, requestCategoryANegativeDecision, retireCategoryAHoldAcknowledgment } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BLUE, BTN, CARD, FIELD, Notice, RetireButton, rs } from "./calc-ui";

/**
 * Category A (engine category-a/2): what the month's adopted calculation HELD, and the negative balances locking it
 * would write off or recover from salary. A held item keeps the month from being submitted, approved or paid until it
 * is resolved at its source (and the month recalculated) or acknowledged with a reason (it then stays as calculated);
 * whoever acknowledges one never approves the month. A write-off or salary recovery is requested by one person and
 * approved or refused by a SECOND. The server checks every action again; without the right everything is read-only.
 */

export interface HeldItemView {
  documentId: string | null;
  documentNo: string | null;
  code: string;
  label: string;
  message: string;
  acknowledged: { id: string; reason: string; byName: string; at: string } | null;
}

function ReasonAction({ label, placeholder, onSubmit }: { label: string; placeholder: string; onSubmit: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input className={`${FIELD} w-72`} placeholder={placeholder} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`${label}: reason`} maxLength={1000} />
      <button
        type="button"
        className={BTN}
        style={{ background: BLUE }}
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await onSubmit(reason.trim());
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setReason("");
        }}
      >
        {label}
      </button>
      {error && (
        <span role="alert" className="text-[12.5px] font-semibold text-[#B91C1C]">
          {error}
        </span>
      )}
    </div>
  );
}

export function AHeldItems({ items, canReview, ready }: { items: HeldItemView[]; canReview: boolean; ready: boolean }) {
  const router = useRouter();
  const open = items.filter((h) => !h.acknowledged).length;
  return (
    <section aria-label="Held items" className="mt-4 rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Held — {items.length ? `${open} of ${items.length} not yet resolved or acknowledged` : "nothing"}</h2>
      <p className="mt-0.5 text-ink-muted">
        What the calculation couldn&apos;t work out is held, never passed over. The month can&apos;t be submitted, approved or paid while anything here is open: resolve it at its source (Forms, or the calculation&apos;s inputs) and recalculate, or acknowledge it with a reason — it then stays as calculated. Whoever acknowledges an item doesn&apos;t approve the month.
      </p>
      {!ready && items.length > 0 && (
        <div className="mt-2">
          <Notice tone="info">Acknowledging a held item needs database update 0142. Until then each one is resolved at its source and the month recalculated.</Notice>
        </div>
      )}
      {items.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {items.map((h, i) => (
            <li key={`${h.documentId}|${h.code}|${i}`} className="rounded-lg border px-3 py-2" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold tracking-[0.08em]" style={{ background: h.acknowledged ? "rgba(34,181,99,0.14)" : "var(--color-amber-bg)", color: h.acknowledged ? "#15803d" : "#92400e" }}>
                  {h.acknowledged ? "ACKNOWLEDGED" : "OPEN"}
                </span>
                <strong className="text-ink-strong">{h.documentNo ?? "—"}</strong>
                <span className="text-ink-muted">{h.label}</span>
              </div>
              <p className="mt-1 text-ink-strong">{h.message}</p>
              {h.acknowledged ? (
                <p className="mt-1 text-ink-muted">
                  Acknowledged by {h.acknowledged.byName}: {h.acknowledged.reason}{" "}
                  {canReview && ready && (
                    <RetireButton
                      label={`the acknowledgment of ${h.documentNo ?? "this item"}`}
                      onRetire={async (reason) => {
                        const r = await retireCategoryAHoldAcknowledgment({ id: h.acknowledged!.id, reason });
                        if (!r.ok) {
                          fireToast({ message: r.error, type: "error" });
                          return false;
                        }
                        fireToast({ message: "Retired: the item holds the month again.", type: "success" });
                        router.refresh();
                      }}
                    />
                  )}
                </p>
              ) : (
                canReview &&
                ready &&
                h.documentId && (
                  <ReasonAction
                    label="Acknowledge"
                    placeholder="Why it stays as calculated (required)"
                    onSubmit={async (reason) => {
                      const r = await acknowledgeCategoryAHold({ documentId: h.documentId!, code: h.code, reason });
                      if (r.ok) {
                        fireToast({ message: "Acknowledged: it stays as calculated.", type: "success" });
                        router.refresh();
                      }
                      return r;
                    }}
                  />
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface NegativeView {
  employeeId: string;
  name: string;
  outcome: "write-off" | "salary-recovery" | "negative-carry";
  amountPaise: number;
  note: string;
  needsSecondPerson: boolean;
  request: { id: string; byId: string | null; byName: string; reason: string; at: string } | null;
  decision: { kind: "approve" | "refuse"; byName: string; reason: string; at: string } | null;
  approved: boolean;
}

const OUTCOME = { "write-off": "written off", "salary-recovery": "recovered from salary", "negative-carry": "carried forward" } as const;

export function ANegativeBalances({ programId, month, items, ready, canRequest, canDecide, me }: { programId: string; month: string; items: NegativeView[]; ready: boolean; canRequest: boolean; canDecide: boolean; me: string }) {
  const router = useRouter();
  if (!items.length) return null;
  return (
    <section aria-label="Negative balances at lock" className="mt-4 rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Negative balances when the month is locked</h2>
      <p className="mt-0.5 text-ink-muted">As the configuration says (&quot;When adjustments make a month negative&quot;). A write-off or a recovery from salary is a decision about money: one person requests it and a second person approves or refuses it, for exactly the amount shown. The month can&apos;t be locked — by hand or automatically — until it is approved.</p>
      {!ready && items.some((x) => x.needsSecondPerson) && (
        <div className="mt-2">
          <Notice tone="info">A second person&apos;s approval needs database update 0142; until then a month with such a balance isn&apos;t locked.</Notice>
        </div>
      )}
      <ul className="mt-2 grid gap-2">
        {items.map((x) => {
          const pending = x.request && !x.decision;
          return (
            <li key={x.employeeId} className="rounded-lg border px-3 py-2" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-ink-strong">{x.name}</strong>
                <span className="tabular-nums">{rs(x.amountPaise)}</span>
                <span className="text-ink-muted">to be {OUTCOME[x.outcome]}</span>
                {x.needsSecondPerson && (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold tracking-[0.08em]" style={{ background: x.approved ? "rgba(34,181,99,0.14)" : "var(--color-amber-bg)", color: x.approved ? "#15803d" : "#92400e" }}>
                    {x.approved ? "APPROVED" : pending ? "AWAITING A SECOND PERSON" : x.decision?.kind === "refuse" ? "REFUSED" : "NEEDS APPROVAL"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-ink-muted">{x.note}</p>
              {x.request && (
                <p className="mt-1 text-ink-muted">
                  Requested by {x.request.byName}: {x.request.reason}
                  {x.decision ? ` · ${x.decision.kind === "approve" ? "Approved" : "Refused"} by ${x.decision.byName}: ${x.decision.reason}` : ""}
                </p>
              )}
              {ready && x.needsSecondPerson && !x.approved && !pending && canRequest && (
                <ReasonAction
                  label="Request approval"
                  placeholder="Why (required)"
                  onSubmit={async (reason) => {
                    const r = await requestCategoryANegativeDecision({ programId, month, employeeId: x.employeeId, reason });
                    if (r.ok) {
                      fireToast({ message: "Requested: a second person approves or refuses it.", type: "success" });
                      router.refresh();
                    }
                    return r;
                  }}
                />
              )}
              {ready && pending && canDecide && x.request!.byId !== me && (
                <div className="flex flex-wrap gap-3">
                  {(["approve", "refuse"] as const).map((d) => (
                    <ReasonAction
                      key={d}
                      label={d === "approve" ? "Approve" : "Refuse"}
                      placeholder="Reason (required)"
                      onSubmit={async (reason) => {
                        const r = await decideCategoryANegativeDecision({ requestId: x.request!.id, decision: d, reason });
                        if (r.ok) {
                          fireToast({ message: d === "approve" ? "Approved." : "Refused.", type: "success" });
                          router.refresh();
                        }
                        return r;
                      }}
                    />
                  ))}
                </div>
              )}
              {ready && pending && x.request!.byId === me && <p className="mt-1 text-ink-muted">You requested it: a second person approves or refuses it.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
