"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import {
  decideCategoryFInvalidation,
  decideCategoryFWriteOff,
  recordCategoryFDecision,
  requestCategoryFInvalidation,
  requestCategoryFWriteOff,
  retireCategoryFDecision,
} from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BLUE, BTN, BTN_PLAIN, CARD, FIELD, Notice, NotReady, RetireButton, day, rs } from "./calc-ui";
import type { FRecovery, FReviewRow } from "@/lib/queries/incentive-f-review";
import type { TestimonialKind } from "@/lib/incentives/categories/f-url";

/**
 * Category F → Review & decisions (0137 + 0138). Every submitted Google review, email or letterhead testimonial with its state: NEW (registered once),
 * DUPLICATE (the same review was already registered — it never earns twice), UNRESOLVED (a short link: link it to the
 * full public review first). A verifier (incentive.f.verify; never the submitter) checks the PUBLIC review and records
 * what it actually says — or rejects it or holds it — and, when the priority needs it, who is credited; always with a
 * reason. Invalidation (incentive.f.invalidate) and recovery write-offs (incentive.f.writeOff) need a second person.
 * Without the right a section is read-only; the server checks every action again. A refusal (a right removed after the
 * page was opened, a validation error, a business rule) is shown as a message: the button is usable again and what was
 * typed stays, so it can be corrected or retried. The page refreshes only after a success.
 */

type Rights = { verify: boolean; invalidate: boolean; writeOff: boolean };
type Person = { id: string; name: string };
type Res = { ok: true } | { ok: false; error: string };
/** Runs one server action and reports it; resolves true on success. Never throws. */
type Done = (action: () => Promise<Res>, message: string) => Promise<boolean>;

/** What is shown if a call fails without an answer (a dropped connection, an expired page) — nothing internal. */
export const F_UNEXPECTED = "That couldn't be completed — your access or the page may have changed. Reload the page to see the current state, then try again.";

/** A form's busy flag around one action: set while it runs, ALWAYS cleared afterwards (success, refusal or failure). */
function useBusy(done: Done): [boolean, Done] {
  const [busy, setBusy] = React.useState(false);
  const run: Done = async (action, message) => {
    setBusy(true);
    try {
      return await done(action, message);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

const STATE: Record<FReviewRow["state"], { label: string; bg: string; fg: string }> = {
  new: { label: "Registered", bg: "#EFF6FF", fg: "#1E40AF" },
  duplicate: { label: "Duplicate — never earns twice", bg: "#F1F5F9", fg: "#334155" },
  unresolved: { label: "Short link — link it first", bg: "#FEF3C7", fg: "#92400E" },
};
const VERDICT: Record<string, string> = { verify: "Verified", reject: "Rejected", "needs-review": "Held for review" };

function Reason({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input className={`${FIELD} w-72`} placeholder="Reason (required)" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} maxLength={1000} />;
}

const KIND_LABEL: Record<TestimonialKind, string> = { google_review: "F.1 Google review", email: "F.2 Testimonial on email", letterhead: "F.3 Testimonial on the customer's letterhead" };
const FINDINGS: Record<"email" | "letterhead", [string, string, string]> = {
  email: ["The email is genuinely from the customer (sender checked)", "It is an email testimonial", "The testimonial is genuine"],
  letterhead: ["The letterhead is the customer's", "It is a testimonial on that letterhead", "The testimonial is genuine"],
};

function PeoplePick({ label, help, people, value, onChange }: { label: string; help: string; people: Person[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
      {label}
      <select multiple className={`${FIELD} h-16 w-56`} value={value} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))} aria-label={label}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="max-w-56 font-normal text-ink-subtle">{help}</span>
    </label>
  );
}

function VerifyForm({ row, people, customers, done }: { row: FReviewRow; people: Person[]; customers: Person[]; done: Done }) {
  const [tk, setTk] = React.useState<TestimonialKind>(row.claimed.kind);
  const [rating, setRating] = React.useState(String(row.claimed.rating ?? 5));
  const [published, setPublished] = React.useState(row.claimed.publishedOn);
  const [text, setText] = React.useState(row.claimed.text ?? "");
  const [gid, setGid] = React.useState("");
  const [named, setNamed] = React.useState<string[]>([]);
  const [appreciated, setAppreciated] = React.useState<string[]>([]);
  const [customer, setCustomer] = React.useState("");
  // What identifies an email or letter, read off the original; the identity itself is derived on the server (0139).
  const [messageId, setMessageId] = React.useState("");
  const [sender, setSender] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [found, setFound] = React.useState<[boolean, boolean, boolean]>([false, false, false]);
  const [reason, setReason] = React.useState("");
  const [busy, run] = useBusy(done);
  const google = tk === "google_review";
  const go = (kind: "verify" | "reject" | "needs-review") =>
    run(
      () =>
        recordCategoryFDecision(
          kind === "verify"
            ? {
                kind,
                reviewId: row.reviewId!,
                reason: reason.trim(),
                testimonialKind: tk,
                rating: google ? Number(rating) : null,
                publishedOn: published,
                reviewText: text.trim() || null,
                googleReviewId: google ? gid.trim() || null : null,
                namedEmployeeIds: named,
                appreciatedEmployeeIds: appreciated,
                customerMasterId: customer || null,
                evidence: google ? null : tk === "email" ? { messageId: messageId.trim() || null, sender: sender.trim() || null, subject: subject.trim() || null } : { reference: reference.trim() || null },
                confirmedFromCustomer: !google && found[0],
                confirmedType: !google && found[1],
                confirmedGenuine: !google && found[2],
              }
            : { kind, reviewId: row.reviewId!, reason: reason.trim() },
        ),
      kind === "verify" ? "Verified. It counts at its month's next calculation." : "Decision recorded.",
    );
  // An email / letterhead testimonial is recorded as verified only with its customer, what identifies it (an email's
  // sender and subject; a letter needs no more than its customer and date) and all three findings.
  const docReady = google || (!!customer && (tk !== "email" || (!!sender.trim() && !!subject.trim())) && found.every(Boolean));
  return (
    <div className="mt-2 grid gap-2" aria-label={`Verify ${row.url}`}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          What it is
          <select className={FIELD} value={tk} onChange={(e) => setTk(e.target.value as TestimonialKind)} aria-label="Testimonial type">
            {(Object.keys(KIND_LABEL) as TestimonialKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {google && (
          <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
            Actual rating
            <select className={FIELD} value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Actual rating">
              {["5", "4", "3", "2", "1"].map((s) => (
                <option key={s} value={s}>
                  {s}★
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          {google ? "Original publication date" : "The email's or letter's own date"}
          <input type="date" className={FIELD} value={published} onChange={(e) => setPublished(e.target.value)} aria-label="Original date" />
        </label>
        {google ? (
          <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
            Google review ID (if shown)
            <input className={`${FIELD} w-48`} value={gid} onChange={(e) => setGid(e.target.value)} aria-label="Google review ID" />
          </label>
        ) : tk === "email" ? (
          <>
            <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
              Sender&apos;s email address (required)
              <input className={`${FIELD} w-56`} value={sender} onChange={(e) => setSender(e.target.value)} aria-label="Sender's email address" maxLength={500} placeholder="name@customer.com" />
            </label>
            <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
              Subject (required; “(no subject)” if none)
              <input className={`${FIELD} w-56`} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Email subject" maxLength={1000} />
            </label>
            <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
              Message-ID (if the email shows one)
              <input className={`${FIELD} w-56`} value={messageId} onChange={(e) => setMessageId(e.target.value)} aria-label="Message-ID" maxLength={1000} placeholder="<…@…>" />
            </label>
          </>
        ) : (
          <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
            Reference number (if the letter has one)
            <input className={`${FIELD} w-56`} value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Letter reference number" maxLength={500} />
          </label>
        )}
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          Customer{google ? "" : " (required)"}
          <select className={`${FIELD} w-48`} value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer">
            <option value="">Not identified</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!google && (
        <fieldset className="grid gap-1 text-[12px] text-ink-strong" aria-label="Verifier's findings">
          {FINDINGS[tk].map((label, i) => (
            <label key={label} className="flex items-center gap-2">
              <input type="checkbox" checked={found[i]} onChange={(e) => setFound((f) => f.map((x, j) => (j === i ? e.target.checked : x)) as [boolean, boolean, boolean])} />
              {label}
            </label>
          ))}
          <span className="text-[11.5px] text-ink-subtle">An uploaded document alone is never enough: check the original and record all three, or reject or hold it.</span>
        </fieldset>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <PeoplePick label="Salespeople named in it" help="Who is credited: the one salesperson it clearly names." people={people} value={named} onChange={setNamed} />
        <PeoplePick label="Appreciated by name (F.4)" help="Only people it categorically appreciates BY NAME — the salesperson or any team member. Vague praise without a name: none." people={people} value={appreciated} onChange={setAppreciated} />
      </div>
      <textarea className={`${FIELD} h-14 w-full`} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text as written" maxLength={10000} />
      <div className="flex flex-wrap items-center gap-2">
        <Reason value={reason} onChange={setReason} label={`Reason for ${row.url}`} />
        <button type="button" className={BTN} style={{ background: BLUE }} disabled={busy || !reason.trim() || !published || !docReady} onClick={() => go("verify")}>
          Verify
        </button>
        <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim()} onClick={() => go("needs-review")}>
          Hold for review
        </button>
        <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim()} onClick={() => go("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}

function LinkForm({ row, done }: { row: FReviewRow; done: Done }) {
  const [url, setUrl] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, run] = useBusy(done);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${FIELD} w-96`} placeholder="The review's full public Google link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={`Full link for ${row.url}`} />
      <Reason value={reason} onChange={setReason} label={`Reason for linking ${row.url}`} />
      <button type="button" className={BTN} style={{ background: BLUE }} disabled={busy || !url.trim() || !reason.trim()} onClick={() => run(() => recordCategoryFDecision({ kind: "link", submissionId: row.submissionId, reason: reason.trim(), url: url.trim() }), "Linked to its review.")}>
        Link
      </button>
    </div>
  );
}

function AttributeForm({ row, people, done }: { row: FReviewRow; people: Person[]; done: Done }) {
  const [who, setWho] = React.useState("");
  const [basis, setBasis] = React.useState<"named" | "assigned" | "claim">(row.verdict?.named.length ? "named" : "assigned");
  const [reason, setReason] = React.useState("");
  const [busy, run] = useBusy(done);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Attribute ${row.url}`}>
      <select className={FIELD} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Credited salesperson">
        <option value="">Credit…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className={FIELD} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} aria-label="Basis">
        <option value="named">Named in the review</option>
        <option value="assigned">The customer&apos;s assigned salesperson</option>
        <option value="claim">A confirmed claim</option>
      </select>
      <Reason value={reason} onChange={setReason} label={`Reason for attributing ${row.url}`} />
      <button type="button" className={BTN} style={{ background: BLUE }} disabled={busy || !who || !reason.trim()} onClick={() => run(() => recordCategoryFDecision({ kind: "attribute", reviewId: row.reviewId!, reason: reason.trim(), creditedEmployeeId: who, basis }), "Attribution recorded.")}>
        Attribute
      </button>
    </div>
  );
}

function InvalidationBox({ row, can, done }: { row: FReviewRow; can: boolean; done: Done }) {
  const [reason, setReason] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [busy, run] = useBusy(done);
  const inv = row.invalidation;
  if (inv && !inv.decided)
    return (
      <div className="mt-2 text-[12.5px]">
        <span className="font-semibold text-[#B91C1C]">Invalidation requested</span> by {inv.byName} — “{inv.reason}”{inv.evidence ? ` (evidence: ${inv.evidence})` : ""}. A second person approves or refuses it.
        {can && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Reason value={reason} onChange={setReason} label={`Reason for deciding the invalidation of ${row.url}`} />
            <button type="button" className={BTN} style={{ background: "#B91C1C" }} disabled={busy || !reason.trim()} onClick={() => run(() => decideCategoryFInvalidation({ requestId: inv.requestId, decision: "approve", reason: reason.trim() }), "Invalidation approved: recalculate its month to recover it.")}>
              Approve invalidation
            </button>
            <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim()} onClick={() => run(() => decideCategoryFInvalidation({ requestId: inv.requestId, decision: "refuse", reason: reason.trim() }), "Invalidation refused.")}>
              Refuse
            </button>
          </div>
        )}
      </div>
    );
  if (inv?.decided === "approved") return <p className="mt-2 text-[12.5px] font-semibold text-[#B91C1C]">Invalidated (approved by a second person). It earns nothing; a paid month is recovered from later months.</p>;
  if (!can || row.verdict?.kind !== "verify") return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Invalidate ${row.url}`}>
      <input className={`${FIELD} w-64`} placeholder="Evidence (required)" value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-label={`Evidence for invalidating ${row.url}`} maxLength={2000} />
      <Reason value={reason} onChange={setReason} label={`Reason for invalidating ${row.url}`} />
      <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim() || !evidence.trim()} onClick={() => run(() => requestCategoryFInvalidation({ reviewId: row.reviewId!, reason: reason.trim(), evidenceUrl: evidence.trim() }), "Invalidation requested: a second person approves it.")}>
        Request invalidation
      </button>
    </div>
  );
}

function WriteOff({ r, can, done }: { r: FRecovery; can: boolean; done: Done }) {
  const [reason, setReason] = React.useState("");
  const [amount, setAmount] = React.useState(String(-r.amountPaise / 100));
  const [busy, run] = useBusy(done);
  const w = r.writeOff;
  if (w?.decided === "approved") return <span className="font-semibold text-ink-strong">Written off {rs(w.amountPaise)} (approved)</span>;
  if (w && !w.decided)
    return (
      <span className="grid gap-1">
        <span>
          Write-off of {rs(w.amountPaise)} requested by {w.byName} — “{w.reason}”
        </span>
        {can && (
          <span className="flex flex-wrap gap-2">
            <Reason value={reason} onChange={setReason} label={`Reason for deciding the write-off for ${r.employeeName}`} />
            <button type="button" className={BTN} style={{ background: "#B91C1C" }} disabled={busy || !reason.trim()} onClick={() => run(() => decideCategoryFWriteOff({ requestId: w.requestId, decision: "approve", reason: reason.trim() }), "Write-off approved.")}>
              Approve
            </button>
            <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim()} onClick={() => run(() => decideCategoryFWriteOff({ requestId: w.requestId, decision: "refuse", reason: reason.trim() }), "Write-off refused.")}>
              Refuse
            </button>
          </span>
        )}
      </span>
    );
  if (!can) return <span className="text-ink-subtle">Recovered from {r.toMonth.slice(0, 7)}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input className={`${FIELD} w-24`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Write-off amount for ${r.employeeName}`} />
      <Reason value={reason} onChange={setReason} label={`Reason for writing off ${r.employeeName}'s recovery`} />
      <button type="button" className={BTN_PLAIN} disabled={busy || !reason.trim() || !(Number(amount) > 0)} onClick={() => run(() => requestCategoryFWriteOff({ adjustmentId: r.adjustmentId, amountPaise: Math.round(Number(amount) * 100), reason: reason.trim(), evidenceUrl: null }), "Write-off requested: a second person approves it.")}>
        Request write-off
      </button>
    </span>
  );
}

export function FReview(p: { ready: boolean; rights: Rights; rows: FReviewRow[]; recoveries: FRecovery[]; people: Person[]; customers: Person[] }) {
  const router = useRouter();
  const done: Done = async (action, message) => {
    let r: Res;
    try {
      r = await action();
    } catch {
      r = { ok: false, error: F_UNEXPECTED }; // never the internal error or its stack
    }
    if (!r.ok) {
      // Refused: say why and keep the form exactly as typed (no refresh), so it can be corrected or retried.
      fireToast({ message: r.error, type: "error" });
      return false;
    }
    fireToast({ message, type: "success" });
    router.refresh();
    return true;
  };
  if (!p.ready) return <NotReady category="F" />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {!p.rights.verify && <Notice tone="info">Read-only: verifying needs the “Verify Category F reviews and testimonials (F.1–F.4)” permission.</Notice>}
      <section aria-label="Submitted testimonials" className="rounded-section bg-white p-4" style={CARD}>
        <h2 className="text-[14px] font-bold text-ink-strong">Submitted reviews and testimonials ({p.rows.length})</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">A Google review, an email or a letterhead testimonial is provisional and earns nothing until it is verified against its original — the public review, the email, the letter. Its month is its own date (a Google review: publication); nobody verifies one they submitted.</p>
        {!p.rows.length && <p className="mt-2 text-[12.5px] text-ink-subtle">Nothing has been submitted yet.</p>}
        <ul className="mt-2 grid gap-3">
          {p.rows.map((r) => (
            <li key={r.submissionId} className="rounded-lg border border-hairline p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded-pill px-2 py-0.5 text-[11px] font-bold" style={{ background: STATE[r.state].bg, color: STATE[r.state].fg }}>
                  {STATE[r.state].label}
                </span>
                <strong className="text-[13px] text-ink-strong">{r.submittedBy}</strong>
                <span className="text-[12px] text-ink-muted">
                  submitted {day(r.submittedAt)} · {KIND_LABEL[r.claimed.kind]} · {r.claimed.kind === "google_review" ? `claims ${r.claimed.rating}★, published` : "dated"} {day(r.claimed.publishedOn)}
                </span>
              </div>
              <p className="mt-1 break-all text-[12.5px]">
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
                  {r.url}
                </a>
                {r.screenshotUrl && (
                  <>
                    {" · "}
                    <a href={r.screenshotUrl} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline" style={{ color: BLUE }}>
                      screenshot
                    </a>
                  </>
                )}
              </p>
              {r.verdict && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-semibold text-ink-strong">
                    {VERDICT[r.verdict.kind] ?? r.verdict.kind}
                    {r.verdict.kind === "verify" ? `: ${r.verdict.testimonialKind ? KIND_LABEL[r.verdict.testimonialKind] : ""}${r.verdict.rating ? `, ${r.verdict.rating}★` : ""}, dated ${day(r.verdict.publishedOn)}${r.verdict.named.length ? `, names ${r.verdict.named.join(", ")}` : ", names no salesperson"}${r.verdict.appreciated.length ? `; appreciates by name (F.4): ${r.verdict.appreciated.join(", ")}` : ""}` : ""}
                  </span>
                  <span className="text-ink-muted">
                    — “{r.verdict.reason}” ({r.verdict.byName})
                  </span>
                  {p.rights.verify && <RetireButton label={`Retire the decision on ${r.url}`} onRetire={(reason) => done(() => retireCategoryFDecision({ id: r.verdict!.id, reason }), "Decision retired.")} />}
                </div>
              )}
              {r.attribution && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-semibold text-ink-strong">
                    Credited to {r.attribution.employeeName ?? "a former employee"} ({r.attribution.basis})
                  </span>
                  <span className="text-ink-muted">
                    — “{r.attribution.reason}” ({r.attribution.byName})
                  </span>
                  {p.rights.verify && <RetireButton label={`Retire the attribution of ${r.url}`} onRetire={(reason) => done(() => retireCategoryFDecision({ id: r.attribution!.id, reason }), "Attribution retired.")} />}
                </div>
              )}
              {p.rights.verify && r.state === "unresolved" && !r.reviewId && <LinkForm row={r} done={done} />}
              {p.rights.verify && r.reviewId && r.state !== "duplicate" && !r.verdict && r.invalidation?.decided !== "approved" && <VerifyForm row={r} people={p.people} customers={p.customers} done={done} />}
              {p.rights.verify && r.verdict?.kind === "verify" && !r.attribution && r.invalidation?.decided !== "approved" && <AttributeForm row={r} people={p.people} done={done} />}
              {r.state !== "duplicate" && <InvalidationBox row={r} can={p.rights.invalidate} done={done} />}
              {r.history.length > 0 && (
                <details className="mt-2 text-[12px] text-ink-muted">
                  <summary className="cursor-pointer">History ({r.history.length})</summary>
                  <ul className="mt-1 grid gap-0.5">
                    {r.history.map((x, i) => (
                      <li key={i}>
                        {day(x.at)} · {x.kind} by {x.byName} — “{x.reason}”{x.retired ? " (retired)" : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Category F recoveries" className="rounded-section bg-white p-4" style={CARD}>
        <h2 className="text-[14px] font-bold text-ink-strong">Recoveries after payout ({p.recoveries.length})</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">An invalidated or reduced review of a paid month is recovered from a later month; a recovery that can&apos;t be made is written off only with a reason and a second person&apos;s approval.</p>
        {p.recoveries.length > 0 && (
          <table className="mt-2 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="py-1 pr-2 font-semibold">Salesperson</th>
                <th className="py-1 pr-2 font-semibold">From</th>
                <th className="py-1 pr-2 font-semibold">Recovered in</th>
                <th className="py-1 pr-2 text-right font-semibold">Amount</th>
                <th className="py-1 font-semibold">Write-off</th>
              </tr>
            </thead>
            <tbody>
              {p.recoveries.map((r) => (
                <tr key={r.adjustmentId} className="border-t border-hairline align-top">
                  <td className="py-1.5 pr-2 text-ink-strong">{r.employeeName}</td>
                  <td className="py-1.5 pr-2">{r.fromMonth.slice(0, 7)}</td>
                  <td className="py-1.5 pr-2">{r.toMonth.slice(0, 7)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{rs(r.amountPaise)}</td>
                  <td className="py-1.5">
                    <WriteOff r={r} can={p.rights.writeOff} done={done} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
