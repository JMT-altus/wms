import { listRecycledClients } from "@/lib/queries/client-kyc";
import { sweepExpiredDraftsQuietly } from "@/lib/masters/draft-sweep";
import { withDbRetry } from "@/lib/db/retry";
import { ClientKycStageList } from "@/components/forms/client-kyc-stage-list";
import { requireAdmin } from "@/lib/auth/current";

/**
 * Never pre-rendered at build time: this page WRITES (the expiry sweep below),
 * and a build must not change business data. The admin check comes first, so
 * the sweep only ever runs for a signed-in admin's real request — reading the
 * session makes the route dynamic before any write, and an unauthenticated or
 * non-admin request stops there. (The Forms layout checks too, but layout and
 * page render concurrently, so the page cannot rely on it to stop the write.)
 */
export const dynamic = "force-dynamic";

/**
 * Recycle Bin — expired drafts and anything sent here by hand.
 *
 * Same pre-read sweep as the Draft page, for the opposite reason: a draft
 * that expired should already BE here when someone looks, rather than
 * arriving whenever the cron next runs.
 */
export default async function ClientKycRecycleBinPage() {
  await requireAdmin();
  await sweepExpiredDraftsQuietly();
  const rows = await withDbRetry("recycled clients", listRecycledClients);
  return <ClientKycStageList mode="recycled" rows={rows} />;
}
