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

export function SubmitPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("leads");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
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

      <div className="mt-4">
        {tab === "leads" && <LeadsForm pending={pending} onSubmit={(leadCount, profiled) => run(() => submitLeadBatch({ leadCount, profiled }), "Leads submitted for review.")} />}
        {tab === "enquiries" && <EnquiriesForm pending={pending} onSubmit={(convertedCount) => run(() => submitLeadConversion({ convertedCount }), "Enquiries submitted for review.")} />}
        {tab === "meeting" && <MeetingForm pending={pending} onSubmit={(potentialBand, justification) => run(() => submitMeeting({ potentialBand, justification }), "Meeting logged — pending admin assessment.")} />}
        {tab === "review" && <ReviewForm pending={pending} onSubmit={(v) => run(() => submitTestimonial(v), "Review submitted for verification.")} />}
      </div>

      {msg && (
        <p className="mt-3 text-[13px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</p>
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
      <SubmitBtn pending={pending}>Submit · ₹250/10</SubmitBtn>
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
      <SubmitBtn pending={pending}>Submit · ₹250/5</SubmitBtn>
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

function ReviewForm({ pending, onSubmit }: { pending: boolean; onSubmit: (v: { kind: "google_review" | "email" | "letterhead"; wordCount: number; starRating?: number; namesTeamMember: boolean; evidenceUrl?: string }) => void }) {
  const [kind, setKind] = useState<"google_review" | "email" | "letterhead">("google_review");
  const [words, setWords] = useState("");
  const [names, setNames] = useState(false);
  const [url, setUrl] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ kind, wordCount: Number(words), starRating: kind === "google_review" ? 5 : undefined, namesTeamMember: names, evidenceUrl: url }); }}
      className="flex items-end gap-3 flex-wrap"
    >
      <label className="min-w-[130px]">
        <span className="text-[12px] font-bold text-ink-subtle">Type</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={inputCls} style={inputStyle}>
          <option value="google_review">Google 5★ · ₹100</option>
          <option value="email">Email · ₹100</option>
          <option value="letterhead">Letterhead · ₹150</option>
        </select>
      </label>
      <label className="min-w-[100px]">
        <span className="text-[12px] font-bold text-ink-subtle">Words</span>
        <input value={words} onChange={(e) => setWords(e.target.value)} type="number" min={0} className={inputCls} style={inputStyle} placeholder="50+" />
      </label>
      <label className="flex-1 min-w-[160px]">
        <span className="text-[12px] font-bold text-ink-subtle">Evidence link</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} style={inputStyle} placeholder="Screenshot / doc URL" />
      </label>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted pb-2.5">
        <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Names a teammate (2×)
      </label>
      <SubmitBtn pending={pending}>Submit</SubmitBtn>
    </form>
  );
}
