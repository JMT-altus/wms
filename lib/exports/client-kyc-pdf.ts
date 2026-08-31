import PDFDocument from "pdfkit";
import { format } from "date-fns";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import { KYC_PDF_COLUMNS } from "@/lib/exports/client-kyc-rich";

/**
 * The Client KYC register, rendered as a landscape A4 PDF.
 *
 * Lives here rather than inside the route handler so it can be exercised
 * without a session: the route is auth + fetch + call, and everything that
 * can actually throw — pdfkit, gradients, pagination — is a plain function
 * over rows that `tests/unit/client-kyc-pdf.test.ts` renders for real.
 *
 * Deliberately NOT marked `server-only`: that would make it unimportable from
 * the test runner, which is the whole point of extracting it. It is only ever
 * imported by a Node-runtime route, and pdfkit is listed in
 * `serverExternalPackages` so it is never bundled for the browser.
 */

/* ── Visual constants. Tweak here; everything below composes them. ── */
const INK = "#0f172a";
const INK_SOFT = "#475569";
const INK_SUBTLE = "#94a3b8";
const HAIRLINE = "#e2e8f0";
const BRAND = "#0A6CFF";
const BRAND_TEAL = "#17B6A0";
const ZEBRA = "#f8fafc";

const HEADER_H = 20;
const ROW_H = 18;
const CELL_PAD = 5;

export interface KycPdfMeta {
  generatedBy: string;
}

export async function renderClientKycPdf(
  rows: ClientMasterRow[],
  meta: KycPdfMeta,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 40,
    info: {
      Title: "JMT Drive Solutions — Client KYC",
      Author: "JMT Drive Solutions",
      Subject: "Client KYC Register",
    },
    bufferPages: true, // needed for the "Page X of Y" pass at the end
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom - 26; // footer room

  // Scale the declared widths to whatever the page actually gives us, so a
  // margin change never leaves the table under- or over-running the page.
  const declared = KYC_PDF_COLUMNS.reduce((n, c) => n + c.pdfWidth, 0);
  const scale = usable / declared;
  const widths = KYC_PDF_COLUMNS.map((c) => c.pdfWidth * scale);

  const active = rows.filter((r) => r.isActive).length;
  const exporters = rows.filter(
    (r) => r.exportClient?.trim().toLowerCase() === "yes",
  ).length;

  drawMasthead(doc, left, right, {
    total: rows.length,
    active,
    exporters,
    generatedBy: meta.generatedBy,
  });

  let y = doc.y + 10;
  y = drawHeaderRow(doc, left, widths, y);

  rows.forEach((row, i) => {
    if (y + ROW_H > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawHeaderRow(doc, left, widths, y);
    }

    if (i % 2 === 1) doc.rect(left, y, usable, ROW_H).fill(ZEBRA);

    let x = left;
    KYC_PDF_COLUMNS.forEach((col, ci) => {
      const w = widths[ci]!;
      doc
        .font(ci === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(7.5)
        .fillColor(ci === 0 ? INK : INK_SOFT)
        .text(col.value(row) || "—", x + CELL_PAD, y + 5.5, {
          width: w - CELL_PAD * 2,
          height: ROW_H - 4,
          ellipsis: true,
          lineBreak: false,
        });
      x += w;
    });

    doc
      .moveTo(left, y + ROW_H)
      .lineTo(right, y + ROW_H)
      .lineWidth(0.4)
      .strokeColor(HAIRLINE)
      .stroke();

    y += ROW_H;
  });

  if (rows.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor(INK_SUBTLE)
      .text("No clients have been onboarded yet.", left, y + 14, {
        width: usable,
        align: "center",
      });
  }

  drawFooters(doc);
  doc.end();
  return done;
}

/** Brand stripe, title, and a one-line stats band. */
function drawMasthead(
  doc: PDFKit.PDFDocument,
  left: number,
  right: number,
  s: { total: number; active: number; exporters: number; generatedBy: string },
): void {
  const top = doc.page.margins.top;

  // Blue → teal stripe, the same gradient the app chrome uses.
  const grad = doc.linearGradient(left, top, right, top);
  grad.stop(0, BRAND).stop(1, BRAND_TEAL);
  doc.rect(left, top, right - left, 3).fill(grad);

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(INK)
    .text("Client KYC Register", left, top + 14);

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(INK_SUBTLE)
    .text(
      `JMT Drive Solutions  ·  ${s.total} clients  ·  ${s.active} active  ·  ` +
        `${s.exporters} export  ·  Generated ${format(new Date(), "d MMM yyyy, HH:mm")} by ${s.generatedBy}`,
      left,
      doc.y + 2,
    );
}

function drawHeaderRow(
  doc: PDFKit.PDFDocument,
  left: number,
  widths: number[],
  y: number,
): number {
  const total = widths.reduce((a, b) => a + b, 0);
  doc.rect(left, y, total, HEADER_H).fill(INK);

  let x = left;
  KYC_PDF_COLUMNS.forEach((col, i) => {
    const w = widths[i]!;
    doc
      .font("Helvetica-Bold")
      .fontSize(6.8)
      .fillColor("#ffffff")
      .text(col.header.toUpperCase(), x + CELL_PAD, y + 6.5, {
        width: w - CELL_PAD * 2,
        characterSpacing: 0.4,
        ellipsis: true,
        lineBreak: false,
      });
    x += w;
  });

  return y + HEADER_H;
}

/** "Page X of Y" plus a confidentiality stamp on every page. */
function drawFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const y = doc.page.height - doc.page.margins.bottom - 12;

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(INK_SUBTLE)
      .text("Confidential — internal use only", left, y, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, left, y, {
        width: right - left,
        align: "right",
        lineBreak: false,
      });
  }
}
