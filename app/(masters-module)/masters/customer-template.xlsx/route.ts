import { requireUser } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { CUSTOMER_CATEGORY_LIST_KEY } from "@/db/enums";
import { listLookupOptions } from "@/lib/queries/master-data";
import { buildCustomerTemplateWorkbook } from "@/lib/masters/customer-workbook";

/**
 * GET /masters/customer-template.xlsx
 *
 * Downloadable Customer Master bulk-upload template: one workbook, three
 * sheets (Basic Details / Account Details / Sales) linked by Customer Code.
 * Mirrors /outstanding/export.xlsx's route shape — a route handler skips
 * layouts, so the module guard runs here too.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireUser();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  if (!(await canAccessModule("masters"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const categoryOptions = await listLookupOptions(CUSTOMER_CATEGORY_LIST_KEY);
  const buffer = await buildCustomerTemplateWorkbook(categoryOptions);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="customer-master-template.xlsx"',
      "cache-control": "no-store",
    },
  });
}
