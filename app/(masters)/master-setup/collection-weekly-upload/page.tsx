import { requireAdmin } from "@/lib/auth/current";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { WeeklyUploadManager } from "@/components/admin/master/weekly-upload-manager";
import { loadWeeklyUploadOverview } from "@/lib/queries/collection-weekly-upload";
import { reportingWeekFor } from "@/lib/collections/weekly-upload/week";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Weekly Bulk Upload: who must upload the Tally
 * customer summary each week, when it is due, and whether this week's upload
 * has been done. Admin-only (the area's gate, checked again here); the setting
 * is saved by a server action that validates the person from the database.
 */
export default async function CollectionWeeklyUploadPage() {
  await requireAdmin();
  const now = new Date();
  const overview = await loadWeeklyUploadOverview(now, reportingWeekFor(now));
  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Weekly Bulk Upload"
        lede={
          <>
            The Collection Tracker&apos;s Tally customer summary must be uploaded every week. Choose who is responsible and the day it is due; WMS creates
            the week&apos;s task, reminds them in their inbox, and marks it done only when a Bulk Upload is confirmed.
          </>
        }
      />
      <WeeklyUploadManager overview={overview} now={now.toISOString()} />
    </div>
  );
}
