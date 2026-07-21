import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { GraduationCap, Search } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Training module — Material Library. Scaffold matching the workspace's other
 * modules: header (module nav + Back to Hub), a search/filter row, and the
 * materials table. Content is empty until training materials are added.
 */
export default function TrainingPage() {
  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1400px] px-8 max-md:px-4 py-10">
        <div
          className="text-[11px] uppercase font-bold tracking-[0.2em]"
          style={{ color: "var(--color-altus-red)" }}
        >
          Training Centre
        </div>
        <h1
          className="mt-2 text-ink-strong"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 48, lineHeight: 1.05, letterSpacing: "-0.02em", fontWeight: 500 }}
        >
          Material library
        </h1>
        <p className="mt-3 text-ink-muted" style={{ fontSize: 16 }}>
          Watch the material and take its tests.
        </p>

        <div className="mt-8 flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex items-center gap-2 rounded-pill px-4 h-11 bg-surface-soft border border-hairline"
            style={{ minWidth: 320 }}
          >
            <Search size={17} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
            <input
              placeholder="Search materials…"
              className="bg-transparent outline-none text-[15px] w-full text-ink-strong"
            />
          </div>
          <span className="inline-flex items-center gap-2 rounded-pill px-4 h-11 bg-surface-soft border border-hairline text-[15px] font-semibold text-ink-soft">
            <GraduationCap size={16} strokeWidth={2.2} /> Induction
          </span>
        </div>

        <p className="mt-8 text-[14px] font-semibold text-ink-muted">0 materials</p>

        <div className="mt-3 rounded-section border border-hairline bg-surface-card overflow-hidden">
          <div className="grid grid-cols-6 gap-4 px-6 py-3.5 text-[12px] font-bold uppercase tracking-wide text-ink-subtle border-b border-hairline">
            <span>Added</span><span>Subject</span><span>Material</span><span>Version</span><span>Created by</span><span>Watched</span>
          </div>
          <div className="py-16 text-center text-ink-muted" style={{ fontSize: 15 }}>
            No materials yet. Training materials, tests, induction, and feedback
            will appear here once added.
          </div>
        </div>
      </main>
      <DashboardFooter />
    </>
  );
}
