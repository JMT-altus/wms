import Link from "next/link";
import type { Route } from "next";
import type { KpiSet, SummaryPillCounts } from "@/lib/types";

interface Pill {
  key: string;
  label: string;
  /** Pill colour; the label and count take a deeper shade of it. */
  hue: string;
  deep: string;
  href: Route;
  value: number;
}

/**
 * The dashboard's summary strip: one row of colourful filter pills — Total, Not
 * read and the workflow states — each a link into the matching task list.
 * Counts come from the figures the dashboard already computes (the KPI set,
 * plus the few extra status counts in `extra`).
 */
export function KpiStrip({ kpis, extra }: { kpis: KpiSet; extra: SummaryPillCounts }) {
  const pills: Pill[] = [
    { key: "total", label: "Total", hue: "#64748b", deep: "#334155", href: "/tasks", value: kpis.total.current },
    { key: "notRead", label: "Not read", hue: "#7c3aed", deep: "#5b21b6", href: "/tasks?unread=1", value: extra.notRead },
    { key: "notStarted", label: "Not started", hue: "#4f46e5", deep: "#3730a3", href: "/tasks?status=not_started", value: kpis.notStarted.current },
    { key: "initiated", label: "Initiated", hue: "#f59e0b", deep: "#92400e", href: "/tasks?status=initiated", value: extra.initiated },
    { key: "followUp", label: "Follow up", hue: "#f97316", deep: "#9a3412", href: "/tasks?status=follow_up", value: extra.followUp },
    { key: "needInfo", label: "Need info", hue: "#ef4444", deep: "#991b1b", href: "/tasks?status=need_info", value: kpis.needHelp.current },
    { key: "done", label: "Done", hue: "#059669", deep: "#065f46", href: "/tasks?status=done,approved", value: kpis.done.current },
    { key: "abandoned", label: "Abandoned", hue: "#0ea5e9", deep: "#075985", href: "/tasks?status=abandoned", value: extra.abandoned },
  ];

  return (
    // No section heading: the pills are the summary. The id stays so anything
    // linking to "task-summary" still lands here.
    <section
      id="task-summary"
      aria-label="Task Summary"
      className="mx-auto max-w-[1600px] px-8 max-md:px-4 dash-anchor pt-3"
    >
      <div className="flex flex-wrap items-center gap-2" role="list">
        {pills.map((p) => (
          <div role="listitem" key={p.key}>
            <Link
              href={p.href}
              aria-label={`${p.label} — view tasks`}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#0A6CFF]/50"
              style={{
                background: `color-mix(in srgb, ${p.hue} 10%, #fff)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${p.hue} 35%, transparent)`,
              }}
            >
              <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: p.hue }} />
              <span
                className="font-bold tabular-nums leading-none"
                style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 14, color: p.deep }}
              >
                {p.value.toLocaleString()}
              </span>
              <span className="whitespace-nowrap text-[12px] font-bold leading-none" style={{ color: p.deep }}>
                {p.label}
              </span>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
