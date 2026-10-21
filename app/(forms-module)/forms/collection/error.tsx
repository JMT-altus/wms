"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";

/**
 * Error state for every Collection page. A page that throws — most often because
 * the person doesn't hold the Collection capability it needs (those guards throw
 * "Forbidden") — lands here with a plain explanation instead of the framework's
 * crash page. Production hides server error messages, so the text covers both
 * causes and never shows details. Scoped to the Collection routes only.
 */
export default function CollectionErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section
      role="alert"
      className="mx-auto w-full max-w-[560px] rounded-section p-10 text-center max-md:p-6"
      style={{ background: "var(--color-surface-card)", border: "1px solid var(--color-hairline)" }}
    >
      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink-subtle">Collections</p>
      <h1 className="mt-2 text-[22px] font-bold text-ink-strong">This page couldn&apos;t be opened</h1>
      <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-muted">
        Either you haven&apos;t been given access to this part of Collections, or something went wrong while loading it. Nothing was changed. If you
        think you should have access, ask a super-admin to check your permissions in Field Permissions.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href={"/forms/collection/tracker" as Route} className="rounded-chip px-5 py-2.5 text-[14px] font-bold text-white" style={{ background: "#0A6CFF" }}>
          Back to the Tracker
        </Link>
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
      </div>
      {error.digest ? <p className="mt-6 font-mono text-xs tabular-nums text-ink-subtle">ref: {error.digest}</p> : null}
    </section>
  );
}
