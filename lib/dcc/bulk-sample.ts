/**
 * DCC — the downloadable sample for Bulk KPI setup.
 *
 * Paste-ready: every line is one the bulk parser (lib/dcc/bulk-import.ts)
 * accepts as written, so the file can be copied into Checklist Text whole and
 * Preview shows its tabs and KPIs with no errors (a unit test holds it to
 * that). The parser has no comment syntax — every "#" line opens a sheet tab
 * and every other non-blank line is a KPI — so the format rules live in the
 * popup's Format guide (DCC_BULK_FORMAT_GUIDE), not in this file.
 *
 * The tab labels are placeholders, not people: Preview suggests a person per
 * tab and the administrator confirms or picks one.
 */
export const DCC_BULK_SAMPLE = [
  "# Tab 1 - Employee name",
  "1 | Tally - Total Value of SO Recd | Daily | Number",
  "2 | Sales - Weekly Calls Sheet Done? (Y/N) | Daily | Yes/No",
  "9 | Sales - Enquiry Funnel - Updated? | Sat / Tues | Yes/No",
  "4.1 | To whom & what brand? | Daily | Text",
  "",
  "# Tab 2 - Employee name",
  "1 | Daily Collection Calls Completed | Daily | Number",
  "2 | Bank Cheques Sent Today? | Daily | Yes/No",
  "3 | Purchase Summary Updated? | Daily | Yes/No",
  "4 | Important Follow-ups | Weekly | Text",
  "",
].join("\r\n");

export const DCC_BULK_SAMPLE_FILENAME = "dcc-bulk-kpi-sample.txt";

/** The format rules, shown beside the Download sample button — the parser's actual rules and words. */
export const DCC_BULK_FORMAT_GUIDE: { rule: string; detail: string }[] = [
  { rule: "# Tab label", detail: "A line starting with # opens a sheet tab (one per employee or group). Every # line is a tab — there are no comment lines." },
  { rule: "One KPI per line", detail: "Sr No | Title | Frequency | Input type — four fields separated by |. Tabs between cells (a copy from Sheets) also work." },
  { rule: "Sr No", detail: "Optional; kept as the KPI code (e.g. 1, 4.1). The title is kept exactly as written." },
  { rule: "Frequency", detail: 'Daily, Weekly, Monthly, days such as "Sat / Tues" or "Wed & Sat", "Mon or Thu", "Every Monday", "prev day", Adhoc, "As and when". Blank is allowed (ad-hoc, no daily cell).' },
  { rule: "Input type", detail: "Number, Yes/No (or Y/N) or Text." },
  { rule: "Blank lines", detail: "Ignored — use them to separate tabs." },
];
