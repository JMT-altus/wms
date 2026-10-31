import Link from "next/link";
import type { Route } from "next";
import { getCollectionCapabilities, requireCollectionCapability } from "@/lib/auth/capability";
import { CollectionMasterImport } from "@/components/collections/master/collection-master-import";
import { TRACKER_ASSIGNMENT_SOURCE, TRACKER_BALANCES_SOURCE, listMasterCompanies, listRecentImports } from "@/lib/queries/collection-master";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const BASE = "/collection/master";

function href(q: string, page: number, coordinator: string) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (page > 0) p.set("page", String(page + 1));
  if (coordinator === "unassigned") p.set("coordinator", "unassigned");
  const s = p.toString();
  return (s ? `${BASE}?${s}` : BASE) as Route;
}

/**
 * Collection Master — the company list behind the Collection screens: name,
 * Sales Coordinator label and payment terms as the master file has them.
 * Separate from the Client Master; admin-only like the rest of Forms.
 */
export default async function CollectionMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; coordinator?: string }>;
}) {
  await requireCollectionCapability("collection.view");
  // The import panel shows only with collection.master.import; its actions check again.
  const canImport = (await getCollectionCapabilities())["collection.master.import"];
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(0, (Number.parseInt(sp.page ?? "1", 10) || 1) - 1);
  const coordinator = sp.coordinator === "unassigned" ? "unassigned" : "all";
  const [list, imports] = await Promise.all([listMasterCompanies({ query: q, page, coordinator }), listRecentImports(5)]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <header>
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          Collection Master
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Companies, their Sales Coordinator and payment terms. Uploading a file never deletes a company or overwrites a stored value without your approval.
        </p>
      </header>

      {canImport && <CollectionMasterImport storageReady={list.storageReady} />}

      <section className="rounded-xl bg-white p-4 max-md:p-3" style={{ border: "1px solid #DCE4F0" }} aria-labelledby="cm-list">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="cm-list" className="text-[15px] font-bold text-ink-strong">
            Companies <span className="font-semibold text-ink-subtle tabular-nums">({list.total})</span>
          </h2>
          <form method="get" action={BASE} className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search company or coordinator"
              aria-label="Search company or coordinator"
              className="h-9 w-64 rounded-lg border border-hairline-strong px-3 text-[13px] max-sm:w-full"
            />
            <select name="coordinator" defaultValue={coordinator} aria-label="Coordinator" className="h-9 rounded-lg border border-hairline-strong px-2 text-[13px] font-semibold">
              <option value="all">All coordinators</option>
              <option value="unassigned">Unassigned only</option>
            </select>
            <button type="submit" className="h-9 rounded-lg px-4 text-[13px] font-bold text-white" style={{ background: "#0A6CFF" }}>
              Search
            </button>
          </form>
        </div>

        {!list.storageReady ? (
          <p className="mt-3 text-[13px] text-ink-muted">The Collection Master isn&apos;t set up yet, so there is nothing to list.</p>
        ) : list.rows.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">{q || coordinator !== "all" ? "No company matches this search." : "No companies yet. Upload the master file above."}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead style={{ background: "#F5F7FB" }}>
                <tr className="text-left text-ink-soft">
                  <th className="px-3 py-2 font-bold">Company</th>
                  <th className="px-3 py-2 font-bold">Sales Coordinator</th>
                  <th className="px-3 py-2 font-bold">Payment Terms</th>
                  <th className="px-3 py-2 font-bold">Client Master</th>
                  <th className="px-3 py-2 font-bold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#EEF1F6]">
                    <td className="px-3 py-2 font-semibold">
                      <Link href={`${BASE}/${r.id}` as Route} className="text-[#0B4FB8] hover:underline">
                        {r.companyName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.coordinatorLabel ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                    <td className="px-3 py-2">{r.paymentTerms ?? <span className="text-ink-subtle">—</span>}</td>
                    <td className="px-3 py-2">
                      {r.clientMatch === "linked" ? "Linked" : r.clientMatch === "ambiguous" ? <span className="font-semibold text-[#B45309]">Ambiguous</span> : <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-subtle">{formatDate(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2 text-[13px]">
            {page > 0 && (
              <Link href={href(q, page - 1, coordinator)} className="rounded-lg border border-hairline-strong px-3 py-1.5 font-semibold">
                Previous
              </Link>
            )}
            <span className="tabular-nums text-ink-subtle">
              Page {Math.min(page + 1, pages)} of {pages}
            </span>
            {page < pages - 1 && (
              <Link href={href(q, page + 1, coordinator)} className="rounded-lg border border-hairline-strong px-3 py-1.5 font-semibold">
                Next
              </Link>
            )}
          </nav>
        )}
      </section>

      {imports.length > 0 && (
        <section className="rounded-xl bg-white p-4 max-md:p-3" style={{ border: "1px solid #DCE4F0" }} aria-labelledby="cm-history">
          <h2 id="cm-history" className="text-[15px] font-bold text-ink-strong">
            Recent imports and changes
          </h2>
          <ul className="mt-2 grid gap-1.5 text-[13px]">
            {imports.map((i) => (
              <li key={i.id} className="text-ink-muted">
                {i.source === TRACKER_ASSIGNMENT_SOURCE ? (
                  <>
                    <strong className="text-ink-strong">Sales Coordinator set in Collection Tracker</strong> · {formatDate(i.importedAt)}
                    {i.importedByName ? ` · ${i.importedByName}` : ""}
                  </>
                ) : i.source === TRACKER_BALANCES_SOURCE ? (
                  <>
                    <strong className="text-ink-strong">Companies added as Unassigned from Tracker Bulk Upload</strong>
                    {i.fileName ? ` (${i.fileName})` : ""} · {formatDate(i.importedAt)}
                    {i.importedByName ? ` · ${i.importedByName}` : ""} · {i.totals.inserted ?? 0} added, {i.totals.alreadyExisted ?? 0} already present, {i.totals.rejected ?? 0} rejected
                  </>
                ) : (
                  <>
                    <strong className="text-ink-strong">{i.fileName ?? "Untitled file"}</strong> · {formatDate(i.importedAt)}
                    {i.importedByName ? ` · ${i.importedByName}` : ""} · {i.totals.inserted ?? 0} added, {i.totals.updated ?? 0} updated, {i.totals.rejected ?? 0} rejected
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
