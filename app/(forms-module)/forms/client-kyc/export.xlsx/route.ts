import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth/current";
import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { MAX_EXPORT_ROWS, EXPORT_TOO_LARGE } from "@/lib/exports/csv";
import {
  KYC_EXPORT_COLUMNS,
  KYC_EXPORT_HEADERS,
  toKycRowArray,
  kycExportFilename,
} from "@/lib/exports/client-kyc-rich";

/**
 * GET /forms/client-kyc/export.xlsx
 *
 * Admin-only spreadsheet of every onboarded Client KYC record — the same
 * `customer_masters` rows the Client Master table shows, with all 32 columns
 * rather than the ones currently ticked on screen.
 *
 * The guard is explicit even though `(forms-module)/forms/layout.tsx` already
 * calls `requireAdmin`: a route handler is not wrapped by the layout, so
 * inheriting that guard is an illusion. Without this line the file is
 * reachable by any signed-in employee who knows the URL.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // requireAdmin throws (rendering error.tsx / a 500) rather than returning,
  // so it is caught and re-answered as a clean 403 — the same shape the task
  // exports use.
  try {
    await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const rows = await listClientMasterRows();

  if (rows.length > MAX_EXPORT_ROWS) {
    return Response.json(
      { error: EXPORT_TOO_LARGE, cap: MAX_EXPORT_ROWS, totalRows: rows.length },
      { status: 422 },
    );
  }

  const aoa: string[][] = [[...KYC_EXPORT_HEADERS], ...rows.map(toKycRowArray)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = KYC_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Client KYC");

  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${kycExportFilename("xlsx")}"`,
      "cache-control": "no-store",
    },
  });
}
