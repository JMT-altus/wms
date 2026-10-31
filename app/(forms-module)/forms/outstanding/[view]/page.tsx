import { notFound } from "next/navigation";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { OUTSTANDING_SORTS, listOutstanding } from "@/lib/queries/tally-ledger";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";
import { OUTSTANDING_VIEWS, isOutstandingView } from "@/lib/tally/sections";
import { SectionHead } from "@/components/forms/tally/ui";
import { OutstandingList } from "@/components/forms/tally/outstanding-list";

export const dynamic = "force-dynamic";

/**
 * Outstanding Balances — /forms/outstanding/receivables and …/payables, two
 * views over `tally_outstanding_lines` split by the stored direction. Each
 * shows one snapshot (the newest completed, or the one picked) and names it.
 * This page only reads; whether the Collection Tracker uses these balances is
 * a separate, deliberate switch (COLLECTION_TRANSACTION_SOURCE) left as it is.
 */
export default async function OutstandingPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<SearchParams> }) {
  const viewer = await requireFormsViewer();
  const { view } = await params;
  if (!isOutstandingView(view)) notFound();
  const def = OUTSTANDING_VIEWS[view];
  const list = readListParams(await searchParams, OUTSTANDING_SORTS, { sort: "pendingPaise", dir: "desc" });
  const page = await listOutstanding(viewer, def.direction, list);
  return (
    <div>
      <SectionHead eyebrow="Forms · Tally ledgers" title={`Outstanding Balances · ${def.label}`} lede={`${def.hint}. One snapshot at a time, from Tally Data Import → Outstanding Balances (${def.direction}).`} />
      <OutstandingList view={view} page={page} params={list} />
    </div>
  );
}
