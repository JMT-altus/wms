import PDFDocument from "pdfkit";
import { format } from "date-fns";

/** A dashboard section, flattened to what a page can hold: a heading, a line
 *  of context, and a grid. Whatever the section looks like on screen — chips,
 *  bars, avatars — it exports as text in columns. */
export interface SectionReport {
  title: string;
  subtitle?: string;
  columns: string[];
  /** Cells as already-formatted strings, in `columns` order. */
  rows: string[][];
  /** How the section was filtered when it was shared, printed under the
   *  masthead so the numbers can't be read out of context. */
  context?: string;
}

const MAX_COLUMNS = 24;
const MAX_ROWS = 2000;

/**
 * Validate a report posted by the browser. The payload is display data the
 * caller already has on screen — this only bounds its size and coerces every
 * cell to a clipped string, so a hostile body can't turn into an enormous or
 * malformed document.
 */
export function parseSectionReport(input: unknown): SectionReport | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.slice(0, 120) : "";
  if (!title) return null;
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  return {
    title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 200) : undefined,
    context: typeof raw.context === "string" ? raw.context.slice(0, 240) : undefined,
    columns: raw.columns.slice(0, MAX_COLUMNS).map((c) => String(c).slice(0, 60)),
    rows: raw.rows
      .slice(0, MAX_ROWS)
      .map((r) =>
        Array.isArray(r) ? r.slice(0, MAX_COLUMNS).map((c) => String(c ?? "").slice(0, 200)) : [],
      ),
  };
}

const BRAND = "#E10600";
const INK = "#0F172A";
const INK_SOFT = "#475569";
const HAIRLINE = "#E2E8F0";
const ZEBRA = "#F8FAFC";

/** Cap on exported rows. A dashboard section is a summary; a thousand-row PDF
 *  is a spreadsheet wearing the wrong clothes. */
export const MAX_SECTION_ROWS = 300;

export function sectionPdfFilename(title: string, now = new Date()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "section"}-${format(now, "yyyy-MM-dd")}.pdf`;
}

/**
 * Render one dashboard section as an A4-landscape PDF: brand stripe, masthead,
 * then the grid with a repeating header row and "Page X of Y" at the foot.
 *
 * Deliberately generic — every section on the dashboard shares this renderer,
 * so a shared report looks the same whichever section it came from, and a new
 * section only has to describe its columns and rows.
 */
export async function renderSectionPdf(
  report: SectionReport,
  meta: { generatedBy: string; generatedAt?: Date },
): Promise<Buffer> {
  const generatedAt = meta.generatedAt ?? new Date();
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 40,
    info: {
      Title: `JMT Drive Solutions — ${report.title}`,
      Author: "JMT Drive Solutions Dashboard",
      Subject: "Internal Dashboard Report",
    },
    bufferPages: true, // needed for the "Page X of Y" pass
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const rows = report.rows.slice(0, MAX_SECTION_ROWS);
  const truncated = report.rows.length - rows.length;

  // First column carries names and gets a third of the page; the rest share
  // what's left, which keeps numeric columns even.
  const colCount = Math.max(report.columns.length, 1);
  const firstWidth = colCount > 1 ? Math.min(width * 0.28, 220) : width;
  const restWidth = colCount > 1 ? (width - firstWidth) / (colCount - 1) : 0;
  const colX: number[] = [];
  const colW: number[] = [];
  let x = left;
  for (let i = 0; i < colCount; i++) {
    const w = i === 0 ? firstWidth : restWidth;
    colX.push(x);
    colW.push(w);
    x += w;
  }

  const ROW_H = 20;

  function stripe() {
    doc.rect(0, 0, doc.page.width, 4).fill(BRAND);
  }

  function masthead() {
    stripe();
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(report.title, left, 30);
    let y = doc.y + 2;
    if (report.subtitle) {
      doc.fillColor(INK_SOFT).font("Helvetica").fontSize(10).text(report.subtitle, left, y);
      y = doc.y + 1;
    }
    if (report.context) {
      doc.fillColor(INK_SOFT).font("Helvetica-Oblique").fontSize(9).text(report.context, left, y);
      y = doc.y + 1;
    }
    doc
      .fillColor(INK_SOFT)
      .font("Helvetica")
      .fontSize(8.5)
      .text(
        `Generated ${format(generatedAt, "d MMM yyyy, h:mm a")} by ${meta.generatedBy}`,
        left,
        y + 2,
      );
    return doc.y + 10;
  }

  function headerRow(y: number) {
    doc.rect(left, y, width, ROW_H).fill("#F1F5F9");
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5);
    report.columns.forEach((label, i) => {
      doc.text(label.toUpperCase(), colX[i]! + 5, y + 6, {
        width: colW[i]! - 10,
        align: i === 0 ? "left" : "center",
        lineBreak: false,
      });
    });
    doc
      .moveTo(left, y + ROW_H)
      .lineTo(right, y + ROW_H)
      .strokeColor(HAIRLINE)
      .lineWidth(0.7)
      .stroke();
    return y + ROW_H;
  }

  let y = masthead();
  y = headerRow(y);

  rows.forEach((row, index) => {
    if (y + ROW_H > bottom - 16) {
      doc.addPage();
      y = masthead();
      y = headerRow(y);
    }
    if (index % 2 === 1) doc.rect(left, y, width, ROW_H).fill(ZEBRA);
    doc.font("Helvetica").fontSize(9);
    row.slice(0, colCount).forEach((cell, i) => {
      doc.fillColor(i === 0 ? INK : INK_SOFT);
      if (i === 0) doc.font("Helvetica-Bold");
      doc.text(cell, colX[i]! + 5, y + 6, {
        width: colW[i]! - 10,
        align: i === 0 ? "left" : "center",
        lineBreak: false,
        ellipsis: true,
      });
      if (i === 0) doc.font("Helvetica");
    });
    doc
      .moveTo(left, y + ROW_H)
      .lineTo(right, y + ROW_H)
      .strokeColor(HAIRLINE)
      .lineWidth(0.4)
      .stroke();
    y += ROW_H;
  });

  if (truncated > 0) {
    doc
      .fillColor(INK_SOFT)
      .font("Helvetica-Oblique")
      .fontSize(8.5)
      .text(`+ ${truncated} more rows not shown (export capped at ${MAX_SECTION_ROWS}).`, left, y + 6);
  }

  // Footer pass — page numbers can only be stamped once the count is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor(INK_SOFT)
      .font("Helvetica")
      .fontSize(8)
      .text(
        `JMT Drive Solutions — internal · Page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - doc.page.margins.bottom + 6,
        { width, align: "center", lineBreak: false },
      );
  }

  doc.end();
  return done;
}
