import { notFound } from "next/navigation";
import { getCollectionCapability } from "@/lib/auth/capability";
import { listClosures } from "@/lib/queries/collection-closures";
import { CollectionLogsList, LogsLoadError, LogsShell } from "@/components/collections/collection-logs";

/**
 * Collection Logs — companies whose collection was closed, newest first, with
 * each closure episode's time (IST), reason, final outstanding, source and
 * whether it was later reopened. READ-ONLY: nothing here closes, reopens, edits
 * or deletes anything, and nothing writes closures yet (automatic closure waits
 * for an approved outstanding-balance source), so today the page is honestly empty.
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
  const data = await listClosures(viewer).catch(() => {
    console.error("[collection-logs] could not load the logs");
    return null;
  });
  return <LogsShell>{data ? <CollectionLogsList rows={data.rows} storageReady={data.storageReady} /> : <LogsLoadError />}</LogsShell>;
}
