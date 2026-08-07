import { Check, ExternalLink, GraduationCap } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getInductionProgress } from "@/lib/queries/training";
import { EmptyState, PageHead, Panel, TRAINING_ACCENT } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function InductionPage() {
  const me = await requireUser();
  const progress = await getInductionProgress(me.id);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1200px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="INDUCTION"
          title="Your Induction"
          sub="The training every new hire must complete."
        />

        {progress.total === 0 ? (
          <EmptyState
            title="No induction material yet."
            sub="An admin marks material as induction from the Library."
          />
        ) : (
          <>
            <Panel className="mb-5">
              <div className="flex items-center gap-7 flex-wrap">
                <Ring pct={progress.pct} />
                <div>
                  <p
                    className="font-black text-ink-strong"
                    style={{
                      fontFamily: "var(--font-display), system-ui, sans-serif",
                      fontSize: 30,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {progress.done} of {progress.total} done
                  </p>
                  <p className="mt-1.5 text-ink-muted" style={{ fontSize: 15.5 }}>
                    {progress.pct === 100
                      ? "Induction complete. Nice work."
                      : "Watch each item and mark it done to complete your induction."}
                  </p>
                </div>
              </div>
            </Panel>

            <ul className="grid gap-3">
              {progress.items.map((m) => (
                <li key={m.id}>
                  <Panel>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-3.5 min-w-0">
                        <span
                          aria-hidden
                          className="grid place-items-center rounded-xl shrink-0"
                          style={{
                            width: 42,
                            height: 42,
                            background: "color-mix(in srgb, var(--color-teal) 14%, transparent)",
                            color: TRAINING_ACCENT,
                          }}
                        >
                          <GraduationCap size={20} strokeWidth={2.2} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-bold text-ink-strong" style={{ fontSize: 16 }}>
                            {m.title}
                          </p>
                          <p className="mt-0.5 text-ink-muted" style={{ fontSize: 13.5 }}>
                            {m.subject ?? "Unsorted"}
                            {m.url && (
                              <>
                                {" · "}
                                <a
                                  href={m.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="inline-flex items-center gap-1 font-bold hover:underline"
                                  style={{ color: TRAINING_ACCENT }}
                                >
                                  Open <ExternalLink size={11} strokeWidth={2.6} />
                                </a>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <span
                        className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 font-bold shrink-0"
                        style={{
                          fontSize: 12.5,
                          background: m.watched
                            ? "color-mix(in srgb, var(--color-green) 14%, transparent)"
                            : "rgba(15,23,42,0.05)",
                          color: m.watched ? "var(--color-green-deep)" : "var(--color-ink-muted)",
                          border: `1px solid ${
                            m.watched
                              ? "color-mix(in srgb, var(--color-green) 30%, transparent)"
                              : "var(--color-hairline)"
                          }`,
                        }}
                      >
                        {m.watched && <Check size={13} strokeWidth={3} />}
                        {m.watched ? "Watched" : "Not yet watched"}
                      </span>
                    </div>
                  </Panel>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-ink-subtle" style={{ fontSize: 13.5 }}>
              Mark items watched from the{" "}
              <a href="/training" className="font-bold hover:underline" style={{ color: TRAINING_ACCENT }}>
                Library
              </a>
              .
            </p>
          </>
        )}
      </main>
      <DashboardFooter />
    </>
  );
}

/** Progress ring — percentage is printed inside, never colour alone. */
function Ring({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
      <svg width={132} height={132} viewBox="0 0 132 132" aria-hidden>
        <circle cx={66} cy={66} r={r} fill="none" stroke="var(--color-surface-track)" strokeWidth={12} />
        <circle
          cx={66}
          cy={66}
          r={r}
          fill="none"
          stroke={TRAINING_ACCENT}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 66 66)"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div
            className="tabular-nums font-black text-ink-strong leading-none"
            style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 30 }}
          >
            {pct}%
          </div>
          <div
            className="uppercase font-bold tracking-[0.12em] text-ink-subtle mt-1"
            style={{ fontSize: 10 }}
          >
            Complete
          </div>
        </div>
      </div>
    </div>
  );
}
