"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";

/**
 * Error state for every Forms page. A "Forbidden" from a page's own gate
 * (Customer Master and Tally Data Import are admin-only inside the module)
 * reads as a plain 403; anything else is a load failure with a retry. Error
 * details are never shown — the digest is enough for an administrator to find
 * it in the logs.
 */
export default function FormsErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message === "Forbidden";
  return (
    <section
      role="alert"
      className="rounded-section w-full max-w-[640px] mx-auto p-14 max-md:p-8 text-center"
      style={{
        background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${forbidden ? "rgba(190, 18, 60, 0.08)" : "rgba(10, 108, 255, 0.10)"}, transparent 70%), linear-gradient(180deg, var(--color-surface-card) 0%, var(--color-surface-soft) 100%)`,
        border: "1px solid var(--color-hairline)",
        boxShadow: "0 14px 32px -20px rgba(190, 18, 60, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
      }}
    >
      <p className="text-ink-subtle" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase" }}>
        {forbidden ? "403" : "Something went wrong"}
      </p>
      <h1 className="text-ink-strong mt-3" style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
        {forbidden ? "Administrators only." : "This page could not be loaded."}
      </h1>
      <p className="text-body-lg text-ink-muted mt-5 mx-auto" style={{ maxWidth: 440, lineHeight: 1.6 }}>
        {forbidden ? "This Forms section is restricted to administrators. The rest of the module is still available from the rail." : "Nothing has been changed. Try again in a moment — if it keeps happening, tell an administrator."}
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link href={"/forms" as Route} className="text-cta text-white px-6 py-3 rounded-chip inline-flex items-center gap-2" style={{ background: "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)", boxShadow: "0 4px 12px rgba(190, 18, 60, 0.25)" }}>
          Forms overview →
        </Link>
        {!forbidden && (
          <Button onClick={reset} variant="outline">
            Try again
          </Button>
        )}
      </div>
      {!forbidden && error.digest ? <p className="text-ink-subtle text-xs mt-8 font-mono tabular-nums">ref: {error.digest}</p> : null}
    </section>
  );
}
