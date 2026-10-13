"use client";

import * as React from "react";
import { CheckCircle2, Download, ArrowUpRight, Search, ShieldCheck } from "lucide-react";

/**
 * The Policies listing: a search bar, a "Firm policies" heading with a signed
 * count, and a grid of policy cards.
 *
 * It lists only what it is GIVEN — the policy records that really exist and the
 * viewer's real acknowledgements. Nothing here invents a policy, a description,
 * a count or a link; when the page has no policy to show, the grid says so.
 * Search is a live filter over the cards already on the page (title, subtitle,
 * version and file name); it never queries anything.
 */

export interface PolicyCardData {
  id: string;
  title: string;
  /** What the policy is, from real fields only (e.g. "Version v1.0 · Published 05-Oct-2026"). */
  subtitle: string;
  version: string;
  fileName: string;
  /** A signed link to the PDF, or null when one could not be made. */
  downloadUrl: string | null;
  /** The viewer's acknowledgement, if they have signed this policy. */
  signed: { label: string } | null;
  /** Where "Read & sign" goes — the document and signing panel on this page. */
  signHref: string;
}

// The reference's palette: a warm off-white page, white cards on a light warm
// border, one red accent for the policy marks, green only for "signed".
const INK = "#1E2A44";
const MUTED = "#6B7385";
const LINE = "#E8E5DF";
const RED = "linear-gradient(145deg, #D81B1B, #B30F0F)";

const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "P";

export function PolicyLibrary({ policies }: { policies: PolicyCardData[] }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();

  const shown = React.useMemo(
    () =>
      q === ""
        ? policies
        : policies.filter((p) =>
            [p.title, p.subtitle, p.version, p.fileName].some((v) => v.toLowerCase().includes(q)),
          ),
    [policies, q],
  );
  const signedCount = policies.filter((p) => p.signed).length;

  return (
    <div className="grid gap-6">
      {/* Search */}
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3.5 max-sm:px-3.5 transition-shadow duration-150 focus-within:shadow-[0_0_0_3px_rgba(216,27,27,0.12)] motion-reduce:transition-none"
        style={{ border: `1px solid ${LINE}` }}
      >
        <Search size={18} strokeWidth={2} aria-hidden style={{ color: MUTED }} className="shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search policies, categories, or file names"
          aria-label="Search policies, categories, or file names"
          // With nothing to search, the control says so rather than pretending.
          disabled={policies.length === 0}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#8A92A3]"
          style={{ color: INK }}
        />
        <button
          type="submit"
          disabled={policies.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 h-9 text-[13.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent transition-colors duration-150 hover:bg-[#F3F1EC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B30F0F] active:bg-[#EBE8E1] motion-reduce:transition-none"
          style={{ color: INK, border: `1px solid ${LINE}` }}
        >
          <Search size={14} strokeWidth={2.2} aria-hidden />
          Search
        </button>
      </form>

      {/* Heading */}
      <div>
        <div className="flex items-center gap-3 mb-3.5">
          <ShieldCheck size={20} strokeWidth={2.1} aria-hidden style={{ color: "#C41414" }} />
          <h2 className="text-[17px] font-bold tracking-[-0.01em]" style={{ color: INK }}>
            Firm policies
          </h2>
          {policies.length > 0 && (
            <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: MUTED }}>
              {signedCount}/{policies.length} signed
            </span>
          )}
        </div>

        {policies.length === 0 ? (
          <p
            className="rounded-2xl bg-white px-5 py-8 text-center text-[14.5px]"
            style={{ border: `1px solid ${LINE}`, color: MUTED }}
          >
            No policies have been published yet.
          </p>
        ) : shown.length === 0 ? (
          <p
            className="rounded-2xl bg-white px-5 py-8 text-center text-[14.5px]"
            style={{ border: `1px solid ${LINE}`, color: MUTED }}
          >
            No policies match &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          <ul className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => (
              <li key={p.id} className="min-w-0">
                <PolicyCard policy={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PolicyCard({ policy: p }: { policy: PolicyCardData }) {
  const action =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-[12px] font-semibold transition-colors duration-150 hover:bg-[#EDEAE3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B30F0F] motion-reduce:transition-none";
  return (
    <article
      className="flex h-full gap-3.5 rounded-2xl bg-white p-4 transition-shadow duration-150 hover:shadow-[0_6px_18px_-12px_rgba(30,42,68,0.3)] motion-reduce:transition-none"
      style={{ border: `1px solid ${LINE}` }}
    >
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-xl text-[13px] font-extrabold tracking-wide text-white"
        style={{ width: 40, height: 40, background: RED }}
      >
        {initialsOf(p.title)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-bold leading-tight pt-0.5" style={{ color: INK }} title={p.title}>
            {p.title}
          </h3>
          {p.signed ? (
            <span
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold"
              style={{ background: "#E6F5EC", color: "#15803D" }}
            >
              <CheckCircle2 size={12} strokeWidth={2.4} aria-hidden />
              {p.signed.label}
            </span>
          ) : (
            <a
              href={p.signHref}
              className={`${action} shrink-0`}
              style={{ background: "#F1EFEA", color: INK }}
            >
              Read &amp; sign
              <ArrowUpRight size={12} strokeWidth={2.4} aria-hidden />
            </a>
          )}
        </div>

        <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: MUTED }}>
          {p.subtitle}
        </p>

        {p.downloadUrl && (
          <div className="mt-2.5 flex justify-end">
            <a
              href={p.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className={action}
              style={{ color: MUTED }}
              aria-label={`Download ${p.title}`}
            >
              <Download size={13} strokeWidth={2.2} aria-hidden />
              Download
            </a>
          </div>
        )}
      </div>
    </article>
  );
}
