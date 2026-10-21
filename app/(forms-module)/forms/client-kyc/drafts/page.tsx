import { listClientDrafts } from "@/lib/queries/client-kyc";
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
 * Draft — every client saved without something the record needs.
 *
 * The sweep runs before the read, not only on the nightly cron, so a draft
 * that expired an hour ago is already in the Recycle Bin by the time anyone
 * opens this page. Without it the list would keep showing "0 days left" rows
 * until the next cron run, which reads as a broken promise.
 */
export default async function ClientKycDraftsPage() {
  await requireAdmin();
  await sweepExpiredDraftsQuietly();
  const rows = await withDbRetry("client drafts", listClientDrafts);
  return <ClientKycStageList mode="draft" rows={rows} />;
}
