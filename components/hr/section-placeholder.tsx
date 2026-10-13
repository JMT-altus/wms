import Link from "next/link";
import type { Route } from "next";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The placeholder page every not-yet-built HR section shares. Reads and writes
 * nothing; `existingHref` points at a feature that already exists elsewhere.
 */
export function HrSectionPlaceholder({
  group,
  label,
  position,
  total,
  existingHref,
}: {
  group: string;
  label: string;
  position: number;
  total: number;
  existingHref?: string;
}) {
  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: "#F7F6F3" }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-6 pb-10 max-md:pb-8 grid gap-6">
          <header>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">
              HR · {group} · {position} of {total}
            </div>
            <h1 className="mt-1 text-[26px] font-bold text-ink-strong">{label}</h1>
          </header>
          <section
            className="rounded-2xl bg-white p-8 max-md:p-5 text-center"
            style={{ border: "1px solid #E8E5DF" }}
          >
            <p className="text-[15px] font-bold text-ink-strong">Not implemented yet</p>
            <p className="mt-1 text-[13.5px] text-ink-muted">
              This section is part of the {group} structure. Its content has not been built.
            </p>
            {existingHref && (
              <Link
                href={existingHref as Route}
                className="mt-4 inline-block text-[13.5px] font-semibold underline underline-offset-2 text-ink-strong"
              >
                Open the existing {label.toLowerCase()} page
              </Link>
            )}
          </section>
        </main>
      </div>
    </>
  );
}
