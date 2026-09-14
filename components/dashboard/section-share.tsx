"use client";

import * as React from "react";
import { Mail, Loader2 } from "lucide-react";
import { emailSectionReport } from "@/app/(app)/dashboard/actions";
import { fireToast } from "@/lib/toast";

/** What a section hands over to be typeset: the grid as it currently reads. */
export interface SectionReportInput {
  title: string;
  subtitle?: string;
  /** How the section was filtered when it was shared. */
  context?: string;
  columns: string[];
  rows: string[][];
}

/**
 * PDF share for a dashboard section: WhatsApp on the left, email on the right.
 *
 * Both render the SAME server-side PDF (`/dashboard/section.pdf`, pdfkit), so
 * the two channels can never disagree about what was shared. They differ only
 * in delivery:
 *
 * - **WhatsApp** can't be handed a file over a URL — wa.me takes text only.
 *   Where the browser supports sharing files (phones, mainly), the PDF goes
 *   straight into the share sheet and WhatsApp is one tap away. Everywhere
 *   else it downloads the PDF and opens WhatsApp with the covering message,
 *   so the file is sitting in Downloads ready to attach.
 * - **Email** sends itself: a server action attaches the PDF and mails it to
 *   the signed-in user's own address. The browser never names a recipient.
 *
 * The report is built on click, not on render, so it always reflects the
 * filter, search and sort in force at that moment.
 */
export function SectionShareActions({
  title,
  buildReport,
}: {
  /** The section's name, for the button labels. Kept separate from
   *  `buildReport` so labelling a button doesn't rebuild the whole grid on
   *  every render. */
  title: string;
  buildReport: () => SectionReportInput;
}) {
  const [busy, setBusy] = React.useState<null | "whatsapp" | "email">(null);

  async function fetchPdf(report: SectionReportInput): Promise<File> {
    const res = await fetch("/dashboard/section.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
    const blob = await res.blob();
    const name =
      report.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "section";
    return new File([blob], `${name}.pdf`, { type: "application/pdf" });
  }

  async function shareWhatsApp() {
    const report = buildReport();
    setBusy("whatsapp");
    try {
      const file = await fetchPdf(report);
      const caption = [report.title, report.subtitle, report.context]
        .filter(Boolean)
        .join(" — ");

      // Phones: hand the file to the OS share sheet, WhatsApp included.
      const canShareFiles =
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({ files: [file], title: report.title, text: caption });
        return;
      }

      // Desktop: save the PDF, then open WhatsApp with the covering message.
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`${caption}\n(PDF attached — ${file.name})`)}`,
        "_blank",
        "noopener,noreferrer",
      );
      fireToast({ message: `${file.name} downloaded — attach it in WhatsApp.` });
    } catch (err) {
      // An aborted share sheet is the user changing their mind, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      fireToast({ message: err instanceof Error ? err.message : "Couldn't build the PDF." });
    } finally {
      setBusy(null);
    }
  }

  async function shareEmail() {
    const report = buildReport();
    setBusy("email");
    try {
      const res = await emailSectionReport(report);
      fireToast({
        message: res.ok ? `Sent to ${res.to}.` : res.error || "Couldn't send the email.",
      });
    } catch {
      fireToast({ message: "Couldn't send the email." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={shareWhatsApp}
        disabled={busy !== null}
        aria-label={`Share ${title} as a PDF on WhatsApp`}
        title="Export PDF to WhatsApp"
        className="inline-flex size-8 items-center justify-center rounded-[10px] transition-colors hover:bg-surface-soft disabled:opacity-50"
        style={{ color: "#25D366" }}
      >
        {busy === "whatsapp" ? (
          <Loader2 size={17} className="animate-spin" aria-hidden />
        ) : (
          // lucide has no WhatsApp glyph — the official mark, inlined.
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
            <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35M12.05 21.8h-.02a9.8 9.8 0 0 1-4.99-1.37l-.36-.21-3.71.97.99-3.62-.23-.37a9.8 9.8 0 0 1-1.5-5.23c0-5.41 4.41-9.81 9.83-9.81a9.75 9.75 0 0 1 6.94 2.88 9.74 9.74 0 0 1 2.87 6.94c0 5.41-4.41 9.82-9.82 9.82m8.35-18.17A11.72 11.72 0 0 0 12.05 0C5.54 0 .24 5.3.23 11.81c0 2.08.55 4.11 1.58 5.91L.13 24l6.42-1.68a11.8 11.8 0 0 0 5.5 1.4h.01c6.51 0 11.81-5.3 11.82-11.81a11.75 11.75 0 0 0-3.47-8.36" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={shareEmail}
        disabled={busy !== null}
        aria-label={`Email ${title} as a PDF`}
        title="Email the PDF to me"
        className="inline-flex size-8 items-center justify-center rounded-[10px] transition-colors hover:bg-surface-soft disabled:opacity-50"
        style={{ color: "var(--color-altus-red)" }}
      >
        {busy === "email" ? (
          <Loader2 size={17} className="animate-spin" aria-hidden />
        ) : (
          <Mail size={18} strokeWidth={2.2} aria-hidden />
        )}
      </button>
    </>
  );
}
