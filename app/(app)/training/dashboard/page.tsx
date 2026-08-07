import { BookOpen, Eye, GraduationCap, Star, Users, Video } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getTrainingDashboard } from "@/lib/queries/training";
import { EmptyState, PageHead, Panel, ProgressBar, StatCard } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function TrainingDashboardPage() {
  await requireUser();
  const d = await getTrainingDashboard();
  const maxSubject = Math.max(...d.bySubject.map((s) => s.n), 1);

  const sharePct = d.activeStaff > 0 ? (d.sharedThisWeek / d.activeStaff) * 100 : 0;
  const learnPct = d.activeStaff > 0 ? (d.hitLearningTarget / d.activeStaff) * 100 : 0;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1400px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="DASHBOARD"
          title="Training Progress"
          sub="Library reach, watch activity and session scores across the team."
        />

        <div className="grid grid-cols-6 max-xl:grid-cols-3 max-sm:grid-cols-2 gap-4">
          <StatCard label="Materials" value={d.materials} tone="teal" icon={<BookOpen size={16} strokeWidth={2.2} />} />
          <StatCard label="Induction" value={d.induction} tone="purple" icon={<GraduationCap size={16} strokeWidth={2.2} />} />
          <StatCard label="Employees" value={d.employees} tone="blue" icon={<Users size={16} strokeWidth={2.2} />} />
          <StatCard label="Watches" value={d.watches} tone="green" icon={<Eye size={16} strokeWidth={2.2} />} />
          <StatCard label="Sessions" value={d.sessions} tone="amber" icon={<Video size={16} strokeWidth={2.2} />} />
          <StatCard
            label="Avg score"
            value={d.avgSessionRating == null ? "—" : d.avgSessionRating.toFixed(1)}
            tone="slate"
            icon={<Star size={16} strokeWidth={2.2} />}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 max-lg:grid-cols-1 gap-5 items-start">
          <Panel>
            <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
              Material by subject
            </h2>
            <div className="mt-4">
              {d.bySubject.length === 0 ? (
                <EmptyState title="No material yet." sub="Add the first item in the Library." />
              ) : (
                <ul className="grid gap-3">
                  {d.bySubject.map((s) => (
                    <li key={s.subject} className="flex items-center gap-3">
                      <span
                        className="font-bold text-ink-soft truncate"
                        style={{ fontSize: 14, width: 150 }}
                        title={s.subject}
                      >
                        {s.subject}
                      </span>
                      <div className="flex-1">
                        <ProgressBar pct={(s.n / maxSubject) * 100} height={12} />
                      </div>
                      <span
                        className="tabular-nums font-black text-ink-strong shrink-0"
                        style={{ fontSize: 15, width: 28, textAlign: "right" }}
                      >
                        {s.n}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel>
            <h2 className="font-bold text-ink-strong" style={{ fontSize: 18 }}>
              This period&rsquo;s obligations
            </h2>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 14 }}>
              How much of the team is keeping up.
            </p>

            <div className="mt-5 grid gap-5">
              <Meter
                label="Logged this week's share"
                done={d.sharedThisWeek}
                total={d.activeStaff}
                pct={sharePct}
              />
              <Meter
                label="Hit the monthly self-learning target"
                done={d.hitLearningTarget}
                total={d.activeStaff}
                pct={learnPct}
              />
            </div>
          </Panel>
        </div>
      </main>
      <DashboardFooter />
    </>
  );
}

function Meter({
  label,
  done,
  total,
  pct,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="font-semibold text-ink-soft" style={{ fontSize: 14.5 }}>
          {label}
        </span>
        <span className="tabular-nums font-black text-ink-strong" style={{ fontSize: 16 }}>
          {done}
          <span className="text-ink-subtle font-bold" style={{ fontSize: 13 }}>
            {" "}
            / {total}
          </span>
        </span>
      </div>
      <ProgressBar pct={pct} tone={pct >= 80 ? "green" : pct >= 40 ? "amber" : "red"} height={12} />
    </div>
  );
}
