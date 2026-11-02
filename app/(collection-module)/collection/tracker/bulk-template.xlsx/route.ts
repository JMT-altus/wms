import { getCollectionCapability } from "@/lib/auth/capability";
import { BALANCE_TEMPLATE_FILENAME } from "@/lib/collections/balances/template";
import { buildBalanceTemplateWorkbook } from "@/lib/collections/balances/template-workbook";

/**
 * GET /collection/tracker/bulk-template.xlsx
 *
 * The Collection Tracker Bulk Upload sample template. Needs exactly what Bulk
 * Upload needs (collection.balances.import inside the Collection module), and
 * nothing more. A route handler skips layouts, so the check runs here.
 *
 * Read-only: it builds a file from fixed sample content and touches no data.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const proof = await getCollectionCapability("collection.balances.import");
  if (!proof) return new Response("Forbidden", { status: 403 });

  const buffer = await buildBalanceTemplateWorkbook();
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${BALANCE_TEMPLATE_FILENAME}"`,
      "cache-control": "no-store",
    },
  });
}
