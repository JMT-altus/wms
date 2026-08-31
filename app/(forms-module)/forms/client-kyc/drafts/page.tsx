import { listClientDrafts } from "@/lib/queries/client-kyc";
import { sweepExpiredDraftsQuietly } from "@/lib/masters/draft-sweep";
import { withDbRetry } from "@/lib/db/retry";
import { ClientKycStageList } from "@/components/forms/client-kyc-stage-list";

/**
 * Draft — every client saved without something the record needs.
 *
 * The sweep runs before the read, not only on the nightly cron, so a draft
 * that expired an hour ago is already in the Recycle Bin by the time anyone
 * opens this page. Without it the list would keep showing "0 days left" rows
 * until the next cron run, which reads as a broken promise.
 */
export default async function ClientKycDraftsPage() {
  await sweepExpiredDraftsQuietly();
  const rows = await withDbRetry("client drafts", listClientDrafts);
  return <ClientKycStageList mode="draft" rows={rows} />;
}
