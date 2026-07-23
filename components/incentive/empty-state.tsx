export function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-[18px] p-8 text-center" style={{ background: "#fff", border: "1px dashed rgba(15,23,42,0.14)" }}>
      <p className="text-ink-strong font-semibold text-[17px]">{title}</p>
      <p className="text-ink-muted text-[14px] mt-1">{sub}</p>
    </div>
  );
}

/** Small page-title header used across the Incentive Tracker routes. */
export function PageHead({ eyebrow, title, sub, right }: { eyebrow: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div>
        <div style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.24em", color: "#0A6CFF" }}>{eyebrow}</div>
        <h1 className="text-display-md text-ink-strong mt-2">{title}</h1>
        {sub && <p className="text-ink-muted mt-1 text-[14.5px]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
