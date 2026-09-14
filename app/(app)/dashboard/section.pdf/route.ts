import { requireUser } from "@/lib/auth/current";
import {
  parseSectionReport,
  renderSectionPdf,
  sectionPdfFilename,
} from "@/lib/exports/section-pdf";

/**
 * POST /dashboard/section.pdf
 *
 * Renders whatever a dashboard section currently shows as a PDF. It's a POST
 * because the payload IS the client's live state — the filter, the search, the
 * sort, the transpose — and that doesn't belong in a URL.
 *
 * Nothing here is trusted as a query: the body carries already-computed
 * numbers the caller can see on screen, and the route only typesets them. The
 * auth check is what stops a signed-out caller from generating a report at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let me;
  try {
    me = await requireUser();
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed body" }, { status: 400 });
  }

  const report = parseSectionReport(body);
  if (!report) return Response.json({ error: "Malformed report" }, { status: 400 });

  const pdf = await renderSectionPdf(report, { generatedBy: me.name });
  const filename = sectionPdfFilename(report.title);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
