"use server";

import { requireUser } from "@/lib/auth/current";
import {
  parseSectionReport,
  renderSectionPdf,
  sectionPdfFilename,
} from "@/lib/exports/section-pdf";
import { sendSectionReportEmail } from "@/lib/email/resend";

/**
 * Email a dashboard section to the signed-in user as a PDF.
 *
 * The recipient is always the caller's own address, resolved on the server:
 * the browser hands over the numbers, never an address, so this can't be
 * turned into a way to mail internal figures to an outsider.
 */
export async function emailSectionReport(
  input: unknown,
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!me.email) return { ok: false, error: "Your account has no email address." };

  const report = parseSectionReport(input);
  if (!report) return { ok: false, error: "Couldn't read the section data." };

  const pdf = await renderSectionPdf(report, { generatedBy: me.name });
  const filename = sectionPdfFilename(report.title);

  const { error } = await sendSectionReportEmail({
    to: me.email,
    recipientName: me.name.split(/\s+/)[0],
    title: report.title,
    subtitle: report.subtitle,
    context: report.context,
    filename,
    pdf,
  });
  if (error) return { ok: false, error };
  return { ok: true, to: me.email };
}
