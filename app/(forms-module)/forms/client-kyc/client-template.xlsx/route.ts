import { requireAdmin } from "@/lib/auth/current";
import { listClientBulkOptions } from "@/lib/queries/client-bulk-options";
import { buildClientTemplateWorkbook } from "@/lib/forms/client-template-workbook";
import { COLUMN_BY_KEY, STANDARD_COLUMN_KEYS } from "@/lib/forms/client-bulk-columns";

/**
 * GET /forms/client-kyc/client-template.xlsx?cols=name,gstin,…
 *
 * The Bulk Import sheet's Template button. An .xlsx rather than a CSV
 * because the point of it is the dropdowns: every option-backed column
 * arrives with a data-validation list built from the live masters, so the
 * file opens in Google Sheets or Excel with the sales roster, customer
 * types, products and admin-managed lists already in it.
 *
 * `cols` is the sheet's current columns, so the template matches what the
 * user is looking at rather than all 31 every time. Anything unrecognised is
 * dropped; an empty or absent list falls back to the standard columns.
 *
 * The guard is explicit even though `(forms-module)/forms/layout.tsx` already
 * calls `requireAdmin`: a route handler is not wrapped by the layout, so
 * inheriting that guard is an illusion — the same note the sibling
 * export.xlsx route carries.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const requested = new URL(request.url).searchParams.get("cols");
  const keys = (requested ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => COLUMN_BY_KEY.has(k));

  const { options } = await listClientBulkOptions();
  const buffer = await buildClientTemplateWorkbook(
    keys.length > 0 ? keys : STANDARD_COLUMN_KEYS,
    options,
  );

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="client-master-template.xlsx"',
      "cache-control": "no-store",
    },
  });
}
