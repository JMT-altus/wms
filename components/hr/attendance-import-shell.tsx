"use client";

import * as React from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

/**
 * Attendance CSV Bulk Upload — structure only.
 *
 * The file input only reports the chosen file's NAME and size from the browser's
 * own File object. The file is never read, parsed, validated or sent anywhere,
 * and nothing here touches attendance, leave or payroll data.
 */

const SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "File preview", body: "The first rows of the chosen file will appear here." },
  { title: "Validation results", body: "Unknown employees, bad dates and duplicate rows will be listed here before anything is imported." },
  { title: "Upload history", body: "Past uploads, who ran them and when will be listed here." },
];

const CARD = "rounded-2xl bg-white p-6 max-md:p-4";
const LINE = { border: "1px solid #E8E5DF" } as const;

function NotBuilt() {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider"
      style={{ background: "#FFFBEB", color: "#B45309", border: "1px solid #FCD9A0" }}
    >
      Not implemented yet
    </span>
  );
}

export function AttendanceImportShell() {
  const [picked, setPicked] = React.useState<{ name: string; kb: number } | null>(null);

  return (
    <div className="grid gap-6">
      <div
        role="note"
        className="rounded-xl px-5 py-3.5 text-[14px] text-ink-muted"
        style={{ background: "#FFFBEB", border: "1px solid #FCD9A0" }}
      >
        <strong className="text-ink-strong">Preview of the layout.</strong> Uploading, validation and
        import are not built yet. Choosing a file here does not read or save it, and no attendance data
        is changed.
      </div>

      <section className={CARD} style={LINE} aria-labelledby="att-upload">
        <h2 id="att-upload" className="text-[16px] font-bold text-ink-strong">
          Choose a CSV file
        </h2>
        <label
          htmlFor="att-csv"
          className="mt-3 block rounded-xl px-6 py-9 text-center cursor-pointer"
          style={{ border: "2px dashed #E8E5DF", background: "#FBFAF8" }}
        >
          <UploadCloud size={32} strokeWidth={1.8} className="mx-auto text-ink-subtle" aria-hidden />
          <span className="mt-2 block text-[14.5px] font-bold text-ink-strong">
            {picked ? picked.name : "Select a .csv file"}
          </span>
          <span className="mt-0.5 block text-[13px] text-ink-muted">
            {picked ? `${picked.kb} KB · selected, not uploaded` : "Click to browse your computer"}
          </span>
          <input
            id="att-csv"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPicked(f ? { name: f.name, kb: Math.max(1, Math.round(f.size / 1024)) } : null);
            }}
          />
        </label>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="rounded-full px-5 py-2.5 text-[14px] font-bold cursor-not-allowed"
            style={{ background: "#EEF0F3", color: "#8A93A0" }}
          >
            Upload
          </button>
          <NotBuilt />
        </div>

        <p className="mt-4 flex items-start gap-2 text-[13px] text-ink-muted">
          <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
          CSV only (.csv), one header row, one attendance record per row. The exact columns will be
          confirmed when import is built.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6">
        {SECTIONS.map((s) => (
          <section key={s.title} className={CARD} style={LINE}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-[16px] font-bold text-ink-strong">{s.title}</h2>
              <NotBuilt />
            </div>
            <p className="mt-2 text-[13.5px] text-ink-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
