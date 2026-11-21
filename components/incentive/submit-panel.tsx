"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitLeadBatch, submitLeadConversion, submitMeeting, submitTestimonial } from "@/app/(app)/incentive/actions";

type Tab = "leads" | "enquiries" | "meeting" | "review";

const TABS: { id: Tab; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "enquiries", label: "Enquiries" },
  { id: "meeting", label: "Meeting" },
  { id: "review", label: "Review" },
];

/**
 * Log activity (Categories D, E and F). What each item earns comes from the configuration in force when the month is
 * calculated, so no amount is shown here. With the "Log activity for an earlier month" permission the month can be
 * chosen (never a future one); otherwise it is the current month.
 */
export function SubmitPanel({ currentMonth, canPickMonth = false }: { currentMonth: string; canPickMonth?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("leads");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const periodMonth = canPickMonth ? month : undefined;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMsg(null);
    start(async () => {
      // A refusal comes back as { ok: false, error } and is shown; a call that fails without an answer (a dropped
      // connection, a changed access) is shown too — never left as an uncaught error. What was typed stays either way.
      let res: { ok: boolean; error?: string };
      try {
        res = await fn();
      } catch {
        res = { ok: false, error: "That couldn't be submitted — your access or the page may have changed. Reload the page, then try again." };
      }
      if (res.ok) {
        setMsg({ ok: true, text: success });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <section className="rounded-[18px] p-5 mb-7" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 26px -18px rgba(15,23,42,0.16)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-display-xs text-ink-strong">Log activity</h2>
        <div className="inline-flex rounded-xl p-1" style={{ background: "rgba(15,23,42,0.05)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setMsg(null); }}
              className="px-3.5 py-1.5 rounded-lg text-[13px] font-bold transition-colors"
              style={tab === t.id ? { background: "#fff", color: "#0a47b3", boxShadow: "0 1px 3px rgba(15,23,42,0.12)" } : { color: "#64748b" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {canPickMonth && (
        <label className="mt-4 inline-flex items-center gap-2">
          <span className="text-[12px] font-bold text-ink-subtle">Incentive month</span>
          <input type="month" value={month} max={currentMonth} onChange={(e) => setMonth(e.target.value)} className="rounded-lg px-3 py-1.5 text-[14px]" style={inputStyle} />
        </label>
      )}
      <div className="mt-4">
        {tab === "leads" && <LeadsForm pending={pending} onSubmit={(leadCount, profiled) => run(() => submitLeadBatch({ leadCount, profiled, periodMonth }), "Leads submitted for review.")} />}
        {tab === "enquiries" && <EnquiriesForm pending={pending} onSubmit={(convertedCount) => run(() => submitLeadConversion({ convertedCount, periodMonth }), "Enquiries submitted for review.")} />}
        {tab === "meeting" && <MeetingForm pending={pending} onSubmit={(potentialBand, justification) => run(() => submitMeeting({ potentialBand, justification, periodMonth }), "Meeting logged — pending admin assessment.")} />}
        {tab === "review" && <ReviewForm pending={pending} onSubmit={(v) => run(() => submitTestimonial({ ...v, periodMonth }), "Review submitted for verification.")} />}
      </div>

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className="mt-3 text-[13px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</p>
      )}
      {tab === "review" && (
        <p className="mt-3 text-[12px] text-ink-subtle leading-[1.5]">
          Never pressure a customer for 5 stars. If the rating is lower, ask what would have earned a 5.
        </p>
      )}
    </section>
  );
}

const inputCls = "rounded-lg px-3 py-2 text-[14px] w-full";
const inputStyle = { background: "#fff", border: "1px solid rgba(15,23,42,0.14)" } as const;

function SubmitBtn({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60 shrink-0"
      style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)", boxShadow: "0 10px 22px -10px rgba(10,108,255,0.5)" }}
    >
      {pending ? "Submitting…" : children}
    </button>
  );
}

function LeadsForm({ pending, onSubmit }: { pending: boolean; onSubmit: (n: number, p: boolean) => void }) {
  const [count, setCount] = useState("");
  const [profiled, setProfiled] = useState(true);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(Number(count), profiled); }} className="flex items-end gap-3 flex-wrap">
      <label className="flex-1 min-w-[140px]">
        <span className="text-[12px] font-bold text-ink-subtle">Number of profiled leads</span>
        <input value={count} onChange={(e) => setCount(e.target.value)} type="number" min={1} className={inputCls} style={inputStyle} placeholder="e.g. 30" />
      </label>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted pb-2.5">
        <input type="checkbox" checked={profiled} onChange={(e) => setProfiled(e.target.checked)} /> Profiled
      </label>
      <SubmitBtn pending={pending}>Submit leads</SubmitBtn>
    </form>
  );
}

function EnquiriesForm({ pending, onSubmit }: { pending: boolean; onSubmit: (n: number) => void }) {
  const [count, setCount] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(Number(count)); }} className="flex items-end gap-3 flex-wrap">
      <label className="flex-1 min-w-[140px]">
        <span className="text-[12px] font-bold text-ink-subtle">Leads converted to valid enquiry</span>
        <input value={count} onChange={(e) => setCount(e.target.value)} type="number" min={1} className={inputCls} style={inputStyle} placeholder="e.g. 10" />
      </label>
      <SubmitBtn pending={pending}>Submit enquiries</SubmitBtn>
    </form>
  );
}

function MeetingForm({ pending, onSubmit }: { pending: boolean; onSubmit: (b: "low" | "medium" | "high", j: string) => void }) {
  const [band, setBand] = useState<"low" | "medium" | "high">("high");
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(band, note); }} className="flex items-end gap-3 flex-wrap">
      <label className="min-w-[120px]">
        <span className="text-[12px] font-bold text-ink-subtle">Potential</span>
        <select value={band} onChange={(e) => setBand(e.target.value as "low" | "medium" | "high")} className={inputCls} style={inputStyle}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </label>
      <label className="flex-1 min-w-[180px]">
        <span className="text-[12px] font-bold text-ink-subtle">Justification</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} style={inputStyle} placeholder="Client, potential value…" />
      </label>
      <SubmitBtn pending={pending}>Log meeting</SubmitBtn>
    </form>
  );
}

/**
 * A review or testimonial. A Google review (Category F, 0137) needs its PUBLIC review link and the date Google shows it
 * was published (its month); a screenshot is supporting evidence. It earns nothing until an authorised verifier checks
 * the public review. Email and letterhead testimonials are recorded as before.
 */
type ReviewValues = { kind: "google_review" | "email" | "letterhead"; wordCount: number; starRating?: number; namesTeamMember: boolean; evidenceUrl?: string; reviewUrl?: string; screenshotUrl?: string; publishedOn?: string; reviewText?: string };
function ReviewForm({ pending, onSubmit }: { pending: boolean; onSubmit: (v: ReviewValues) => void }) {
  const [kind, setKind] = useState<"google_review" | "email" | "letterhead">("google_review");
  const [stars, setStars] = useState("5");
  const [words, setWords] = useState("");
  const [names, setNames] = useState(false);
  const [url, setUrl] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [shot, setShot] = useState("");
  const [published, setPublished] = useState("");
  const [text, setText] = useState("");
  const google = kind === "google_review";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          google
            ? { kind, wordCount: 0, starRating: Number(stars), namesTeamMember: names, reviewUrl: reviewUrl.trim(), screenshotUrl: shot.trim() || undefined, publishedOn: published, reviewText: text.trim() || undefined }
            : { kind, wordCount: Number(words), namesTeamMember: names, evidenceUrl: url.trim(), publishedOn: published, reviewText: text.trim() || undefined },
        );
      }}
      className="flex items-end gap-3 flex-wrap"
      aria-label="Submit a review or testimonial"
    >
      <label className="min-w-[130px]">
        <span className="text-[12px] font-bold text-ink-subtle">Type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls} style={inputStyle}>
          <option value="google_review">Google review</option>
          <option value="email">Email</option>
          <option value="letterhead">Letterhead</option>
        </select>
      </label>
      {google ? (
        <>
          <label className="flex-1 min-w-[220px]">
            <span className="text-[12px] font-bold text-ink-subtle">Public Google review link (required)</span>
            <input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} required className={inputCls} style={inputStyle} placeholder="https://www.google.com/maps/…" aria-label="Public Google review link" />
          </label>
          <label className="min-w-[150px]">
            <span className="text-[12px] font-bold text-ink-subtle">Published on (as Google shows)</span>
            <input value={published} onChange={(e) => setPublished(e.target.value)} required type="date" className={inputCls} style={inputStyle} aria-label="Published on" />
          </label>
          <label className="min-w-[90px]">
            <span className="text-[12px] font-bold text-ink-subtle">Stars</span>
            <select value={stars} onChange={(e) => setStars(e.target.value)} className={inputCls} style={inputStyle} aria-label="Stars">
              {["5", "4", "3", "2", "1"].map((s) => <option key={s} value={s}>{s}★</option>)}
            </select>
          </label>
          <label className="flex-1 min-w-[180px]">
            <span className="text-[12px] font-bold text-ink-subtle">Screenshot link</span>
            <input value={shot} onChange={(e) => setShot(e.target.value)} className={inputCls} style={inputStyle} placeholder="Screenshot URL" aria-label="Screenshot link" />
          </label>
          <label className="basis-full">
            <span className="text-[12px] font-bold text-ink-subtle">Review text (as published)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={2} className={inputCls} style={inputStyle} aria-label="Review text" />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted pb-2.5">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Names me
          </label>
          <span className="basis-full text-[12px] text-ink-subtle">It earns nothing until an authorised reviewer checks the public review; its month is the date it was published.</span>
        </>
      ) : (
        <>
          <label className="min-w-[100px]">
            <span className="text-[12px] font-bold text-ink-subtle">Words</span>
            <input value={words} onChange={(e) => setWords(e.target.value)} type="number" min={0} className={inputCls} style={inputStyle} placeholder="e.g. 60" />
          </label>
          <label className="flex-1 min-w-[160px]">
            <span className="text-[12px] font-bold text-ink-subtle">{kind === "email" ? "Link to the email (required)" : "Link to the scanned letter (required)"}</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} required className={inputCls} style={inputStyle} placeholder="Uploaded email / letter URL" aria-label="Evidence link" />
          </label>
          <label className="min-w-[150px]">
            <span className="text-[12px] font-bold text-ink-subtle">{kind === "email" ? "Date of the email" : "Date of the letter"}</span>
            <input value={published} onChange={(e) => setPublished(e.target.value)} required type="date" className={inputCls} style={inputStyle} aria-label="Dated" />
          </label>
          <label className="basis-full">
            <span className="text-[12px] font-bold text-ink-subtle">Testimonial text (as written)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={2} className={inputCls} style={inputStyle} aria-label="Testimonial text" />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted pb-2.5">
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Appreciates me or a teammate by name
          </label>
          <span className="basis-full text-[12px] text-ink-subtle">It earns nothing until an authorised reviewer checks that it is genuinely from the customer; its month is the date on it.</span>
        </>
      )}
      <SubmitBtn pending={pending}>Submit</SubmitBtn>
    </form>
  );
}
