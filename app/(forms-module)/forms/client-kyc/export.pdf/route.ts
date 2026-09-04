import { requireAdmin } from "@/lib/auth/current";
import { listClientMasterRows } from "@/lib/queries/client-kyc";
import { MAX_EXPORT_ROWS, EXPORT_TOO_LARGE } from "@/lib/exports/csv";
import { kycExportFilename } from "@/lib/exports/client-kyc-rich";
import { renderClientKycPdf } from "@/lib/exports/client-kyc-pdf";

/**
 * GET /forms/client-kyc/export.pdf
 *
 * Admin-only landscape A4 report of every onboarded Client KYC record, laid
 * out for reading and signing off rather than for re-import — the XLSX route
 * beside this one carries all 32 columns for that.
 *
 * Deliberately thin: auth, fetch, delegate. The rendering lives in
 * lib/exports/client-kyc-pdf.ts so it can be unit-tested without a session —
 * a PDF generator that can only be exercised by clicking a button in a
 * logged-in browser is one nobody ever checks until it breaks in front of a
 * user.
 *
 * The guard is explicit even though the Forms layout already calls
 * `requireAdmin`: a route handler is not wrapped by its layout, so the file
 * would otherwise be reachable by any signed-in employee with the URL.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // requireAdmin throws (rendering error.tsx / a 500) rather than returning,
  // so it is caught and re-answered as a clean 403 — the shape the task
  // exports already use.
  let me;
  try {
    me = await requireAdmin();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  // 0101 — dormant customers are off the register, so they are off the
  // register's exports too. Filtered here rather than in the query, because
  // the Client Master needs them loaded for its Status → Dormant filter; this
  // file is the register you hand to someone, and a parked customer in it
  // reads as a client you still trade with.
  const rows = (await listClientMasterRows()).filter((r) => r.dormantAt === null);

  if (rows.length > MAX_EXPORT_ROWS) {
    return Response.json(
      { error: EXPORT_TOO_LARGE, cap: MAX_EXPORT_ROWS, totalRows: rows.length },
      { status: 422 },
    );
  }

  const buffer = await renderClientKycPdf(rows, { generatedBy: me.name });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${kycExportFilename("pdf")}"`,
      "cache-control": "no-store",
    },
  });
}
