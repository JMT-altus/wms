import { formatInrPaise } from "@/lib/format";

export interface FeedRow { actor: string | null; action: string; detail: Record<string, unknown>; at: Date; }

const ACTION: Record<string, string> = {
  logged_sale: "logged a deal", edited_sale: "edited a deal", deleted_sale: "deleted a deal",
  recorded_payment: "recorded a payment", approved: "approved a submission", rejected: "rejected a submission",
  locked: "locked the period", paid: "marked the period paid", published_scheme: "published a scheme version", recomputed: "recomputed the ledger",
};

/** A compact "who did what, when" feed used on the overview, rep and admin surfaces. */
export function ActivityFeed({ rows }: { rows: FeedRow[] }) {
  if (rows.length === 0) return <p className="text-ink-muted text-[13.5px]">Nothing yet — logging a sale or a payment will show up here.</p>;
  return (
    <div className="rounded-[16px] p-5 grid gap-3" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
      {rows.map((a, i) => (
        <div key={i} className="flex items-start gap-3 text-[13px]">
          <span className="inline-block size-2 rounded-full mt-1.5 shrink-0" style={{ background: a.action === "recorded_payment" ? "#22b563" : a.action.includes("delete") || a.action.includes("reject") ? "#ef4444" : "#0a6cff" }} />
          <div className="leading-[1.5]">
            <span className="font-bold text-ink-strong">{a.actor ?? "Someone"}</span> <span className="text-ink-muted">{ACTION[a.action] ?? a.action}</span>
            {typeof a.detail.amountPaise === "number" && <span className="text-ink-muted"> · {formatInrPaise(a.detail.amountPaise as number)}</span>}
            {typeof a.detail.customer === "string" && <span className="text-ink-muted"> · {a.detail.customer as string}</span>}
            <div className="text-ink-subtle text-[11.5px] mt-0.5">{a.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
