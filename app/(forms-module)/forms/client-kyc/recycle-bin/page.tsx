import { listRecycledClients } from "@/lib/queries/client-kyc";
import { sweepExpiredDraftsQuietly } from "@/lib/masters/draft-sweep";
import { withDbRetry } from "@/lib/db/retry";
import { ClientKycStageList } from "@/components/forms/client-kyc-stage-list";

/**
 * Recycle Bin — expired drafts and anything sent here by hand.
 *
 * Same pre-read sweep as the Draft page, for the opposite reason: a draft
 * that expired should already BE here when someone looks, rather than
 * arriving whenever the cron next runs.
 */
export default async function ClientKycRecycleBinPage() {
  await sweepExpiredDraftsQuietly();
  const rows = await withDbRetry("recycled clients", listRecycledClients);
  return <ClientKycStageList mode="recycled" rows={rows} />;
}
