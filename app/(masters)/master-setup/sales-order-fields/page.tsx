import { requireAdmin } from "@/lib/auth/current";
import { canManageSalesOrderFields } from "@/lib/auth/sales-order-fields";
import { listFieldHistory, loadSalesOrderCatalogue } from "@/lib/queries/sales-order-fields";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { SalesOrderFieldsManager } from "@/components/admin/master/sales-order-fields-manager";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Sales Order Fields: the fields of TallyPrime's Sales Order matrix, and custom fields, as the
 * Sales Order form, import, template and order page use them. Admins can look; changing anything needs a super-admin
 * or the sensitive `sales-orders.fields.manage` permission (checked again by every action).
 */
export default async function SalesOrderFieldsPage() {
  const me = await requireAdmin();
  const [canManage, load, history] = await Promise.all([canManageSalesOrderFields(me), loadSalesOrderCatalogue(), listFieldHistory(100)]);
  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Sales Order Fields"
        lede={<>Which fields every Sales Order carries — on the form, in Excel/CSV imports, in the template and on the order page — and when each is mandatory. Configuration version {load.catalogue.version}.</>}
      />
      <SalesOrderFieldsManager settings={load.settings} version={load.catalogue.version} ready={load.ready} canManage={canManage} history={history.rows.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() }))} />
    </div>
  );
}
