import { requireUser } from "@/lib/auth/current";
import { getMyActivity, type ActivityRow } from "@/lib/queries/incentive-views";
import { SubmitPanel } from "@/components/incentive/submit-panel";
import { EmptyState, PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

const A_STATUS: Record<ActivityRow["status"], { bg: string; fg: string }> = {
  pending: { bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  approved: { bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  rejected: { bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
};

export default async function ActivityPage() {
  const me = await requireUser();
  const activity = await getMyActivity(me.id);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <PageHead eyebrow="ACTIVITY" title="Activity" sub="Log leads, meetings and reviews. Each earns once your admin approves it." />
      <SubmitPanel />
      <h2 className="text-display-xs text-ink-strong mb-3">Submitted</h2>
      {activity.length === 0 ? (
        <EmptyState title="No submissions yet." sub="Log leads, meetings and reviews above — they appear here with their review status." />
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {activity.map((a, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
              <span className="shrink-0 inline-flex items-center rounded-md px-2 py-1 text-[10.5px] font-extrabold tracking-[0.08em]" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", minWidth: 78, justifyContent: "center" }}>{a.type.toUpperCase()}</span>
              <div className="flex-1 min-w-0"><span className="text-ink-strong text-[13.5px] font-semibold">{a.summary}</span> <span className="text-ink-subtle text-[12px]">· {a.period}</span></div>
              <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: A_STATUS[a.status].bg, color: A_STATUS[a.status].fg }}>{a.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
