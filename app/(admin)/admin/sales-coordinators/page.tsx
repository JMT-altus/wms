import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { listCoordinatorLinks } from "@/lib/queries/coordinator-links";
import { SalesCoordinatorLinks } from "@/components/admin/sales-coordinator-links";

export const dynamic = "force-dynamic";

/**
 * Admin Panel → Sales Coordinators: which login is which Sales Coordinator in the
 * Collection Master — what decides whose scorecard the Collection Tracker shows a
 * person. Admins can see it; only super-admins can change it, never for their own
 * login (checked again on the server).
 */
export default async function SalesCoordinatorsPage() {
  const me = await requireAdmin();
  const data = await listCoordinatorLinks();
  return (
    <div>
      <header className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-tight text-ink-strong">Sales Coordinators</h1>
        <p className="mt-1 max-w-[720px] text-[14px] text-ink-subtle">
          Link each login to the Sales Coordinator name the Collection Master uses, so they see their own scorecard on the Collection Tracker.
          Mark admin and system logins as “Not a Sales Coordinator”. Nothing is linked automatically.
        </p>
      </header>
      <SalesCoordinatorLinks storageReady={data.storageReady} rows={data.rows} labels={data.labels} canEdit={isSuperAdmin(me.email)} myId={me.id} />
    </div>
  );
}
