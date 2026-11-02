import { notFound } from "next/navigation";
import { getCollectionCapability } from "@/lib/auth/capability";
import { listClosures } from "@/lib/queries/collection-closures";
import { inScope } from "@/lib/collections/scope";
import { collectionScopeFor } from "@/lib/collections/scope-server";
import { CollectionLogsList, LogsLoadError, LogsShell } from "@/components/collections/collection-logs";

/**
 * Collection Logs — companies a confirmed Bulk Upload gave ₹0 Debit and ₹0
 * Credit, newest first, with each episode's time (IST), final figures, source
 * and whether a later upload returned it to the Tracker. READ-ONLY: this page
 * closes, reopens, edits or deletes nothing. The only writer is the confirmed
 * Bulk Upload (lib/queries/collection-closures-write.ts).
 *
 * Needs collection.logs.view, checked on the server from the signed session
 * before any data is read; without it the page is a plain "not found". Loading
 * and crash states come from the Collection segment's loading.tsx / error.tsx.
 */
export const dynamic = "force-dynamic";

export default async function CollectionLogsPage() {
  const viewer = await getCollectionCapability("collection.logs.view");
  if (!viewer) notFound();
  // A failed load shows a clear message instead of a crash page; details are never shown or logged.
  const scope = await collectionScopeFor();
  const data = await listClosures(viewer).catch(() => {
    console.error("[collection-logs] could not load the logs");
    return null;
  });
  // The same scope as the Tracker: only closures of companies the person may see.
  const rows = data ? data.rows.filter((r) => inScope(scope, r.collectionPerson)) : [];
  return <LogsShell>{data ? <CollectionLogsList rows={rows} storageReady={data.storageReady} /> : <LogsLoadError />}</LogsShell>;
}
