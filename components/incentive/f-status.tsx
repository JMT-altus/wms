import type { MyFStatus, MyFTestimonial } from "@/lib/queries/incentive-f-review";

/**
 * My Activity → "Reviews and testimonials — verification": the signed-in employee's OWN Category F submissions with their
 * verification state and a standard explanation. Read only: no verify, approve, invalidate or write-off control exists
 * here, and nothing internal (a reviewer's notes or name, evidence links, who is credited or appreciated) is shown.
 */
const KIND: Record<MyFTestimonial["kind"], string> = { google_review: "F.1 Google review", email: "F.2 Email testimonial", letterhead: "F.3 Letterhead testimonial" };
const STATUS: Record<MyFStatus, { label: string; bg: string; fg: string }> = {
  submitted: { label: "SUBMITTED", bg: "rgba(10,108,255,0.08)", fg: "#0a47b3" },
  duplicate: { label: "DUPLICATE", bg: "rgba(100,116,139,0.14)", fg: "#475569" },
  "under-review": { label: "UNDER REVIEW", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  "on-hold": { label: "ON HOLD", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  verified: { label: "VERIFIED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  rejected: { label: "REJECTED", bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
  invalidated: { label: "INVALIDATED", bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
};
const day = (iso: string) => iso.slice(0, 10);

export function MyTestimonialStatus({ rows }: { rows: MyFTestimonial[] }) {
  return (
    <section aria-label="My testimonials — verification" className="mt-8">
      <h2 className="text-display-xs text-ink-strong mb-1">Reviews and testimonials — verification</h2>
      <p className="mb-3 text-[12.5px] text-ink-muted">Each Google review, email or letterhead testimonial you submit is checked against its original by an authorised verifier — never by you — and earns only once it is verified, in the month of its own date.</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-subtle">No reviews or testimonials submitted yet.</p>
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {rows.map((r, i) => (
            <div key={r.submissionId} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3.5" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
              <div className="min-w-0 flex-1">
                <span className="text-ink-strong text-[13.5px] font-semibold">{KIND[r.kind]}</span>{" "}
                <span className="text-ink-subtle text-[12px]">
                  · dated {r.ownDate} · submitted {day(r.submittedAt)}
                  {r.countsIn ? ` · counts in ${r.countsIn}` : ""}
                  {r.appreciation ? " · appreciation by name recorded (F.4)" : ""}
                </span>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">{r.explanation}</p>
              </div>
              <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: STATUS[r.status].bg, color: STATUS[r.status].fg }}>
                {STATUS[r.status].label}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
