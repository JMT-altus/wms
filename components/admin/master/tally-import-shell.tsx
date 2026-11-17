"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Building2,
  Download,
  FileDown,
  FileInput,
  FileSpreadsheet,
  FileText,
  Loader2,
  Receipt,
  ReceiptText,
  Scale,
  ShoppingCart,
  Truck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { DateField } from "@/components/ui/date-field";
import { TALLY_CATEGORIES, TALLY_LIMITS, salesOrderMappingFields, type TallyCategoryKey } from "@/lib/tally/categories";
import { checkMapping, findHeaderRow, mappingIsUsable, suggestMapping, type TallyMapping } from "@/lib/tally/mapping";
import { chunkRows, planRows, summarize, type PlannedRow, type RawRow, type TallyDirection } from "@/lib/tally/plan";
import { salesOrderViews, summarizeSalesOrders } from "@/lib/tally/sales-orders";
import { buildCatalogue, ignoredHeading, importFields, sectionLabel, type FieldSetting, type SoCatalogue } from "@/lib/tally/sales-order-config";
import { NO_LINKS, mergeMatches, type SalesOrderLinks, type SalesOrderMatches } from "@/lib/tally/sales-order-match";
import { hasReportableProblems, salesOrderErrorReport } from "@/lib/tally/error-report";
import { DOCUMENT_SECTIONS, salesOrderImportHref } from "@/lib/tally/sections";
import { SalesOrderPreview, type LinkOption } from "@/components/forms/tally/sales-order-preview";
import { SalesOrderEntryForm } from "@/components/forms/tally/sales-order-entry-form";
import { salesOrderFormLinks, salesOrderFormRows, type SoFormOrder, type SoFormRowSource } from "@/lib/tally/sales-order-form";
import { partyKey } from "@/lib/tally/values";
import type { TallyField } from "@/lib/tally/categories";
import { checkTallyChunk, finishTallyImport, getSalesOrderCustomer, getSavedTallyMapping, getTallyBatchProblems, importTallyChunk, startTallyImport } from "@/app/(forms-module)/forms/tally-import/actions";
import type { HistoryRow } from "@/lib/queries/tally-import";

/**
 * Tally Data Import. The file is read in this browser and only its cells go to
 * the server, which plans and validates them again. Nothing is written until the
 * person has validated the file and confirmed. See lib/tally/.
 *
 * With `lockedCategory="sales-orders"` this is the Sales Order import inside
 * Forms → Sales Orders: the same pipeline and the same server actions, with the
 * category fixed, Tally's own template to download, an order-by-order preview
 * and the customer / item matching. The general page sends its Sales Orders
 * card there, so there is one Sales Order import, not two.
 */

interface Category {
  key: TallyCategoryKey;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: "customer-master", label: "Customer Master", hint: "Ledgers under Sundry Debtors", icon: Users },
  { key: "vendor-master", label: "Vendor Master", hint: "Ledgers under Sundry Creditors", icon: Building2 },
  { key: "sales-orders", label: "Sales Orders", hint: "Open and fulfilled orders", icon: ShoppingCart },
  { key: "sales-invoices", label: "Sales Invoices / Tax Invoices", hint: "Sales vouchers", icon: ReceiptText },
  { key: "purchase-invoices", label: "Purchase Invoices", hint: "Purchase vouchers", icon: Truck },
  { key: "credit-notes", label: "Credit Notes", hint: "Sales returns and adjustments", icon: FileInput },
  { key: "debit-notes", label: "Debit Notes", hint: "Purchase returns and adjustments", icon: FileDown },
  { key: "customer-receipts", label: "Customer Receipts (Cash/Bank)", hint: "Receipt vouchers", icon: Banknote },
  { key: "vendor-payments", label: "Vendor Payments (Cash/Bank)", hint: "Payment vouchers", icon: Receipt },
  { key: "outstanding-balances", label: "Outstanding Balances", hint: "Bills receivable and payable", icon: Scale },
];

const BASE_CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-hairline)",
  boxShadow: "0 14px 32px -20px rgba(245, 158, 11, 0.2), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
};
const FIELD = "h-9 rounded-lg border border-hairline-strong bg-white px-2 text-[13px] text-ink-strong";
const PRIMARY = "rounded-pill px-5 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
/* The Forms module's rose (see STYLES.forms in app/(app)/hub/page.tsx): this screen is a Forms section now. */
const FORMS_ACCENT = "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)";
const FORMS_ACCENT_BAR = "linear-gradient(90deg, #FB7185 0%, #BE123C 100%)";
/* The Sales Order import uses the WMS blue on white. */
const SO_ACCENT = "linear-gradient(135deg, #0A6CFF 0%, #0B4FB8 100%)";
const SO_ACCENT_BAR = "linear-gradient(90deg, #0A6CFF 0%, #0B4FB8 100%)";
const SO_BLUE = "#0B4FB8";
const SO_CARD_STYLE: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 14px 32px -20px rgba(11, 79, 184, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const SO_STEPS = ["Upload", "Column mapping", "Validation", "Preview", "Confirmation", "Import result"] as const;
/** Entering an order on the form has no file to upload or map. */
const SO_FORM_STEPS = ["Enter the order", "Validation", "Preview", "Confirmation", "Import result"] as const;

/** Hands the browser a file to save. */
function saveFile(name: string, part: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STATE_LABEL: Record<PlannedRow["state"], string> = { valid: "Valid", attention: "Needs attention", duplicate: "Duplicate", invalid: "Invalid" };

interface Loaded {
  fileName: string;
  sheet: string;
  /** Every sheet of the workbook that has data. */
  sheets: string[];
  hash: string;
  headers: string[];
  rows: RawRow[];
  /** Sales Orders entered on the form: what each generated row is, and the master records the person chose. */
  manual?: { sources: SoFormRowSource[]; customerKey: string; customerId: string; products: Record<string, string> };
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: tone ?? "var(--color-ink-strong)" }}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

const when = (d: Date | string | null) => fmtDateTime(d) || "—";

export function TallyImportShell({
  canImport = false,
  storageReady = true,
  history = [],
  lockedCategory,
  linkOptions,
  importBlocked,
  soSettings,
  soConfigVersion = 0,
}: {
  canImport?: boolean;
  storageReady?: boolean;
  history?: HistoryRow[];
  /** Fixes the category (the Sales Order import inside Forms → Sales Orders). */
  lockedCategory?: TallyCategoryKey;
  /** Sales Orders: the master records an unrecognised name can be matched to. */
  linkOptions?: { customers: LinkOption[]; products: LinkOption[]; ledgers?: LinkOption[] };
  /** Why importing is off although checking works (a database update is pending). The server refuses too. */
  importBlocked?: string;
  /** Sales Orders: the field settings of Admin & Master Setup → Sales Order Fields, and the configuration version they make. */
  soSettings?: FieldSetting[];
  soConfigVersion?: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<TallyCategoryKey | null>(lockedCategory ?? null);
  const so = selected === "sales-orders";
  /** The effective Sales Order configuration: the mapping, the planner, the template and the form all read it, and the server refuses a version that is no longer current. */
  const catalogue = React.useMemo(() => buildCatalogue(soSettings ?? [], soConfigVersion), [soSettings, soConfigVersion]);
  const soFields = React.useMemo(() => salesOrderMappingFields(catalogue), [catalogue]);
  const fieldList = so ? soFields : undefined;
  const version = so ? { fieldConfigVersion: catalogue.version } : {};
  /** Sales Orders: from a file, or one order entered on the form. Both go through the same validation and import. */
  const [mode, setMode] = React.useState<"file" | "form">("file");
  const PRIMARY_STYLE: React.CSSProperties = { fontSize: 14, background: so ? SO_ACCENT : FORMS_ACCENT };
  const CARD_STYLE = so ? SO_CARD_STYLE : BASE_CARD_STYLE;
  const [matches, setMatches] = React.useState<SalesOrderMatches | null>(null);
  const [links, setLinks] = React.useState<SalesOrderLinks>(NO_LINKS);
  const [stale, setStale] = React.useState(false);
  const source = React.useRef<{ name: string; bytes: Uint8Array } | null>(null);
  const category = CATEGORIES.find((c) => c.key === selected) ?? null;
  const [file, setFile] = React.useState<Loaded | null>(null);
  const [reading, setReading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [mapping, setMapping] = React.useState<TallyMapping>({});
  const [asOfDate, setAsOfDate] = React.useState("");
  const [direction, setDirection] = React.useState<TallyDirection | "">("");
  const [checked, setChecked] = React.useState<PlannedRow[] | null>(null);
  const [progress, setProgress] = React.useState<{ label: string; done: number; total: number } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [includeAttention, setIncludeAttention] = React.useState(false);
  const [ackInvalid, setAckInvalid] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof finishTallyImport>> | null>(null);
  const [details, setDetails] = React.useState<{ id: string; rows: Awaited<ReturnType<typeof getTallyBatchProblems>> } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const def = selected ? TALLY_CATEGORIES[selected] : null;
  const isOutstanding = def?.kind === "outstanding";
  const sample = React.useMemo(() => (file ? file.rows.slice(0, 50).map((r) => r.cells) : []), [file]);
  const problems = selected && file ? checkMapping(selected, mapping, file.headers, sample, fieldList) : null;
  const mappingOk = problems ? mappingIsUsable(problems) : false;
  const settingsOk = !isOutstanding || (!!asOfDate && !!direction);
  const summary = checked ? summarize(checked, includeAttention) : null;
  const busy = progress !== null;
  // Sales orders are counted as orders, not rows: one order is many rows.
  const orders = React.useMemo(() => (so && checked && file ? salesOrderViews(checked, file.rows, mapping, catalogue) : null), [so, checked, file, mapping, catalogue]);
  const orderSummary = orders ? summarizeSalesOrders(orders, includeAttention) : null;
  const canRun = importBlocked
    ? false
    : orderSummary
    ? !busy && !stale && orderSummary.ready > 0 && (orderSummary.invalid === 0 || ackInvalid) && !(file?.manual && formMismatchOf(file, matches))
    : !!checked && !busy && summary!.ready > 0 && (summary!.invalid === 0 || ackInvalid);

  function resetChecks() {
    setChecked(null);
    setResult(null);
    setProblem(null);
    setAckInvalid(false);
    setIncludeAttention(false);
    setMatches(null);
    setStale(false);
  }

  function choose(key: TallyCategoryKey) {
    // Sales Orders have their own screen inside Forms → Sales Orders: one import, not two.
    if (key === "sales-orders" && !lockedCategory) return router.push(salesOrderImportHref);
    setSelected(key === selected ? null : key);
    setFile(null);
    setMapping({});
    setFileError(null);
    setLinks(NO_LINKS);
    resetChecks();
  }

  async function onFile(picked: File | undefined, sheet?: string) {
    if (!selected) return;
    // Choosing another worksheet reads the same bytes again; nothing is uploaded twice.
    if (!picked && !(sheet && source.current)) return;
    setFileError(null);
    setFile(null);
    resetChecks();
    setLinks(NO_LINKS);
    setReading(true);
    try {
      const lib = await import("@/lib/tally/workbook");
      if (picked) {
        const bad = lib.checkTallyFile(picked.name, picked.size);
        if (bad) return setFileError(bad);
        source.current = { name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) };
      }
      const { name, bytes } = source.current!;
      const read = lib.readTallyBytes(name, bytes, sheet);
      if (!read.ok) return setFileError(read.error);
      const head = findHeaderRow(selected, read.grid, selected === "sales-orders" ? soFields : undefined);
      const headers = (read.grid[head] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
      const rows = read.grid.slice(head + 1).map((cells, i) => ({ rowNo: head + i + 2, cells })).filter((r) => r.cells.some((c) => c.trim()));
      if (rows.length === 0) return setFileError("This file has headings but no data rows.");
      if (rows.length > TALLY_LIMITS.rows) return setFileError(`This file has more than ${TALLY_LIMITS.rows.toLocaleString("en-IN")} rows. Split it by financial year.`);
      const saved = await getSavedTallyMapping(selected).catch(() => null);
      setMapping(suggestMapping(selected, headers, rows.slice(0, 50).map((r) => r.cells), saved, selected === "sales-orders" ? soFields : undefined));
      setFile({ fileName: name, sheet: read.sheet, sheets: read.sheets, hash: await lib.hashGrid(read.grid), headers, rows });
    } catch {
      setFileError("This file could not be read. It may be damaged.");
    } finally {
      setReading(false);
    }
  }

  function setField(key: string, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[key];
      else next[key] = Number(value);
      return next;
    });
    resetChecks();
  }

  const options = () => ({ asOfDate: asOfDate || null, direction: direction || null });
  const planLocally = (f: Loaded = file!, m: TallyMapping = mapping) => planRows(selected!, f.rows, m, { ...options(), today: new Date().toISOString().slice(0, 10), ...(so ? { soCatalogue: catalogue } : {}) });
  /** Rows the plan ignores (Tally's total lines, blanks) are never sent or counted. */
  const liveRows = (plan: { rows: PlannedRow[] }, f: Loaded = file!) => {
    const keep = new Set(plan.rows.map((r) => r.rowNo));
    return f.rows.filter((r) => keep.has(r.rowNo));
  };

  /** Validation of the file — or of the form's rows, passed in directly, since state set in the same click can't be read yet. */
  async function validate(over?: { file: Loaded; mapping: TallyMapping; links: SalesOrderLinks }) {
    resetChecks();
    const f = over?.file ?? file!;
    const m = over?.mapping ?? mapping;
    const l = over?.links ?? links;
    const plan = planLocally(f, m);
    const chunks = chunkRows(liveRows(plan, f), plan.rows);
    const all: PlannedRow[] = [];
    const found: SalesOrderMatches[] = [];
    setProgress({ label: "Validating", done: 0, total: chunks.length });
    try {
      for (let i = 0; i < chunks.length; i++) {
        const res = await checkTallyChunk({ category: selected, mapping: m, rows: chunks[i], ...options(), ...version, ...(so ? { links: l } : {}) });
        if (!res.ok) return setProblem(res.error);
        all.push(...res.rows);
        if (res.matches) found.push(res.matches);
        setProgress({ label: "Validating", done: i + 1, total: chunks.length });
      }
      if (so) setMatches(mergeMatches(found));
      setChecked(all.sort((a, b) => a.rowNo - b.rowNo));
    } catch {
      setProblem("Validation could not finish. Nothing was changed. Please try again.");
    } finally {
      setProgress(null);
    }
  }

  async function runImport() {
    setConfirming(false);
    setProblem(null);
    const plan = planLocally();
    const rows = liveRows(plan);
    try {
      const started = await startTallyImport({ category: selected, fileName: file!.fileName, fileHash: file!.hash, sheetName: file!.sheet, headers: file!.headers, sample: file!.rows.slice(0, 50), mapping, totalRows: rows.length, ...options(), includeAttention, confirm: true, ...version });
      if (!started.ok) return setProblem(started.error);
      const done = new Set(started.doneRowNos);
      const chunks = chunkRows(rows.filter((r) => !done.has(r.rowNo)), plan.rows);
      setProgress({ label: "Importing", done: 0, total: chunks.length });
      for (let i = 0; i < chunks.length; i++) {
        const part = { batchId: started.batchId, rows: chunks[i], ...version, ...(so ? { links } : {}) };
        let res = await importTallyChunk(part).catch(() => null);
        if (!res) res = await importTallyChunk(part).catch(() => null);
        if (!res) {
          setProblem("The connection dropped during the import. Upload the same file again to continue where it stopped: nothing will be imported twice.");
          break;
        }
        setProgress({ label: "Importing", done: i + 1, total: chunks.length });
      }
      const finished = await finishTallyImport(started.batchId);
      setResult(finished);
      if (finished.ok) {
        const b = finished.batch;
        const done = so ? `Imported ${(finished.documents ?? 0).toLocaleString("en-IN")} sales orders.` : `Imported ${b.importedRows.toLocaleString("en-IN")} rows.`;
        fireToast({ message: b.status === "completed" ? done : `Import finished with ${b.failedRows} rows not saved.`, type: b.status === "completed" ? "success" : "error" });
      }
      router.refresh();
    } catch {
      setProblem("The import stopped. Upload the same file again to continue: nothing will be imported twice.");
    } finally {
      setProgress(null);
    }
  }

  async function showDetails(id: string) {
    if (details?.id === id) return setDetails(null);
    setDetails({ id, rows: await getTallyBatchProblems(id) });
  }

  /**
   * "Check order" on the form: the order becomes the rows a template file would hold (with the template's headings,
   * so every column maps to itself) and is validated exactly like an upload. The customer and items the person chose
   * go with it as matches; the server still checks each against the masters.
   */
  async function checkOrder(order: SoFormOrder) {
    const built = salesOrderFormRows(order, catalogue);
    const grid = [built.headers, ...built.rows.map((r) => r.cells)];
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(grid)));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const formLinks = salesOrderFormLinks(order);
    const loaded: Loaded = {
      fileName: `Entered on the form — ${(order.voucher.documentNo ?? "").trim() || "no voucher number"}`,
      sheet: "Form",
      sheets: ["Form"],
      hash,
      headers: built.headers,
      rows: built.rows,
      manual: { sources: built.sources, customerKey: partyKey(order.customerName), customerId: order.customerId, products: formLinks.products },
    };
    const identity: TallyMapping = Object.fromEntries(importFields(catalogue).map((f, i) => [f.key, i]));
    setFile(loaded);
    setMapping(identity);
    setLinks(formLinks);
    await validate({ file: loaded, mapping: identity, links: formLinks });
  }

  /** A match a person chose. The preview stays, marked stale: it must be validated again before importing. */
  function setLink(kind: "customers" | "products" | "ledgers", key: string, value: string) {
    setLinks((l) => {
      const next = { ...l[kind] };
      if (value) next[key] = value;
      else delete next[key];
      return { ...l, [kind]: next };
    });
    setStale(true);
  }

  async function downloadTemplate() {
    try {
      const [lib, template] = await Promise.all([import("@/lib/tally/workbook"), import("@/lib/tally/sales-order-template")]);
      saveFile(template.SO_TEMPLATE_FILE, lib.writeWorkbook(template.salesOrderTemplateSheets(catalogue)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch {
      fireToast({ message: "The template couldn't be prepared. Please try again.", type: "error" });
    }
  }

  function downloadReport() {
    if (!orders || !hasReportableProblems(orders)) return;
    saveFile(`${(file?.fileName ?? "sales-orders").replace(/\.(xlsx|csv)$/i, "")} - problems.csv`, salesOrderErrorReport(orders), "text/csv;charset=utf-8");
  }

  /**
   * The form: every message of the check, against the part of the form it belongs to, and a refusal when the server
   * matched the customer or an item to another record than the one chosen (a name another record also carries).
   * Display only — the server decides validity; this only stops an import the person didn't mean.
   */
  const formProblems = React.useMemo(() => {
    if (!file?.manual || !checked) return [];
    const where = new Map(file.manual.sources.map((x) => [x.rowNo, x.label]));
    const out: { where: string; text: string }[] = [];
    for (const r of checked) for (const text of r.messages) if (!/^Not imported: row \d+/.test(text)) out.push({ where: where.get(r.rowNo) ?? `Row ${r.rowNo}`, text });
    const c = matches?.customers.find((x) => x.key === file.manual!.customerKey);
    if (c?.ref && file.manual.customerId && c.ref !== file.manual.customerId) out.push({ where: "Customer", text: `The import would match this order to "${c.label}", not the customer you chose. The Customer Master names need to be unique first.` });
    for (const [key, ref] of Object.entries(file.manual.products)) {
      const pm = matches?.products.find((x) => x.key === key);
      if (pm?.ref && pm.ref !== ref) out.push({ where: "Items", text: `"${pm.name}" would be matched to "${pm.label}", not the item you chose.` });
    }
    return out;
  }, [file, checked, matches]);

  const finished = result && "ok" in result && result.ok ? result.batch : null;
  const createdOrders = result && "ok" in result && result.ok ? (result.documents ?? 0) : 0;
  const flagged = checked?.filter((r) => r.state !== "valid") ?? [];
  const steps: readonly string[] = so && mode === "form" ? SO_FORM_STEPS : SO_STEPS;
  const fileStep = !so ? 0 : finished ? 5 : confirming ? 4 : checked ? 3 : progress?.label === "Validating" ? 2 : file ? 1 : 0;
  // The form's steps are the file's without "Column mapping".
  const step = so && mode === "form" ? Math.max(0, fileStep - 1) : fileStep;
  /** The section numbers: the Sales Order import has no category to choose. */
  const no = (n: number) => (lockedCategory ? n - 1 : n);

  return (
    <div className="space-y-8">
      {!storageReady && (
        <div role="status" className="rounded-section px-5 py-4 text-ink-muted" style={{ fontSize: 14, background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">Not set up yet.</strong> Tally import needs database update 0122. You can read a file and check its columns, but nothing can be validated or imported until it is applied.
        </div>
      )}
      {!canImport && (
        <div role="note" className="rounded-section px-5 py-4 text-ink-muted" style={{ fontSize: 14, background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">View only.</strong> Validating and importing need the &ldquo;Tally Data Import — Upload and import&rdquo; permission, which a super-admin grants in Field Permissions.
        </div>
      )}

      {so && (
        <ol aria-label="Import steps" className="flex flex-wrap gap-x-1.5 gap-y-2 text-[12.5px] font-bold">
          {steps.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1" style={i === step ? { background: SO_BLUE, color: "#fff" } : i < step ? { background: "#E6EFFC", color: SO_BLUE } : { background: "#EEF1F6", color: "#5B6B85" }}>
                <span className="tabular-nums">{i + 1}</span> {label}
              </span>
              {i < steps.length - 1 && (
                <span aria-hidden className="text-ink-subtle">
                  ›
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {!lockedCategory && (
      <section aria-labelledby="tally-category">
        <h2 id="tally-category" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          1 · What are you importing?
        </h2>
        <div className="mt-3 grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = c.key === selected;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => choose(c.key)}
                className="rounded-section bg-surface-card p-4 text-left transition-transform hover:-translate-y-0.5"
                style={{ ...BASE_CARD_STYLE, border: on ? "1.5px solid #BE123C" : BASE_CARD_STYLE.border }}
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden className="grid place-items-center rounded-xl shrink-0" style={{ width: 38, height: 38, background: "#FDF2F6", color: "#B8325F" }}>
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                      {c.label}
                    </span>
                    <span className="block mt-0.5 text-ink-muted" style={{ fontSize: 12.5 }}>
                      {c.hint}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      )}

      {so && lockedCategory && (
        <div role="tablist" aria-label="How to add sales orders" className="inline-flex rounded-pill p-1" style={{ background: "#EEF1F6" }}>
          {([["file", "Upload a file"], ["form", "Enter an order"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              disabled={busy}
              onClick={() => {
                if (mode === key) return;
                setMode(key);
                setFile(null);
                setMapping({});
                setFileError(null);
                setLinks(NO_LINKS);
                resetChecks();
              }}
              className="rounded-pill px-4 py-1.5 text-[13px] font-bold"
              style={mode === key ? { background: SO_BLUE, color: "#fff" } : { color: "#5B6B85" }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {so && mode === "form" && (
        <section aria-labelledby="tally-form">
          <h2 id="tally-form" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
            1 · Enter the Sales Order
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">Every field of TallyPrime&apos;s Sales Order matrix. A red star marks a required field; the ? and optional fields are in the collapsed panels. Checking writes nothing.</p>
          <div className="mt-3">
            <SalesOrderEntryForm
              options={{ customers: linkOptions?.customers ?? [], products: linkOptions?.products ?? [], ledgers: linkOptions?.ledgers ?? [] }}
              disabled={!canImport || !storageReady}
              busy={busy}
              problems={formProblems}
              onCheck={(order) => void checkOrder(order)}
              loadCustomer={getSalesOrderCustomer}
              catalogue={catalogue}
            />
          </div>
        </section>
      )}

      {!(so && mode === "form") && (
      <section aria-labelledby="tally-upload">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 id="tally-upload" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
            {no(2)} · {so ? "Upload the Sales Order file" : "Upload the export"}
          </h2>
          {so && (
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[13px] font-bold" style={{ color: SO_BLUE }}>
              <Download size={15} strokeWidth={2.2} aria-hidden /> Download template
            </button>
          )}
        </div>
        <div className="mt-3 rounded-section bg-surface-card p-6" style={CARD_STYLE}>
          <div
            className="rounded-xl px-6 py-10 text-center"
            style={{ border: `2px dashed ${dragging ? (so ? SO_BLUE : "#BE123C") : "var(--color-hairline)"}`, background: so ? "#F6F8FB" : "var(--color-surface-soft)" }}
            onDragOver={(e) => {
              e.preventDefault();
              if (selected) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={34} strokeWidth={1.8} className="mx-auto text-ink-subtle" aria-hidden />
            <p className="mt-3 font-bold text-ink-strong" style={{ fontSize: 15 }}>
              {category ? `Upload file for ${category.label}` : "Choose a category above, then upload its export"}
            </p>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 13 }}>
              {so
                ? "Drag and drop the Excel file here, or choose it from your computer. TallyPrime's Sales Order import format is read as it is. Uploading only reads the file: nothing is imported yet."
                : "Drag and drop a file here, or choose one from your computer. Uploading only reads it: nothing is imported yet."}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              aria-label={so ? "Sales Order file" : "Tally export file"}
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="mt-4">
              <button type="button" disabled={!selected || reading} onClick={() => inputRef.current?.click()} className={PRIMARY} style={PRIMARY_STYLE}>
                {reading ? "Reading…" : "Upload file"}
              </button>
            </div>
            {fileError && (
              <p role="alert" className="mt-3 text-[13px] font-semibold text-[#B91C1C]">
                {fileError}
              </p>
            )}
            {file && (
              <p role="status" className="mt-3 text-[13px] font-semibold text-ink-strong">
                {file.fileName} · {file.rows.length.toLocaleString("en-IN")} rows · sheet {file.sheet}
              </p>
            )}
            {file && file.sheets.length > 1 && (
              <label className="mt-3 inline-flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
                Worksheet
                <select aria-label="Worksheet" className={FIELD} value={file.sheet} disabled={reading || busy} onChange={(e) => void onFile(undefined, e.target.value)}>
                  {file.sheets.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <dl className="mt-5 grid grid-cols-3 max-md:grid-cols-1 gap-4" style={{ fontSize: 13 }}>
            <div className="flex items-start gap-2.5">
              <FileSpreadsheet size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Formats</dt>
                <dd className="text-ink-muted">{so ? "Excel (.xlsx) or CSV (.csv), in Tally's Sales Order import format. Use the template if you're starting from scratch." : "Excel (.xlsx) or CSV (.csv), exported from Tally."}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileText size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Layout</dt>
                <dd className="text-ink-muted">
                  {so ? "One row per ledger or product line. The rows under a voucher number, up to the next one, are one order with all its products." : "One record per row. Titles above the headings and total rows are handled."}
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileInput size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Limits</dt>
                <dd className="text-ink-muted">
                  Up to {TALLY_LIMITS.fileBytes / (1024 * 1024)} MB and {TALLY_LIMITS.rows.toLocaleString("en-IN")} rows per file. Use one file per financial year for larger histories.
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </section>

      )}

      <section aria-labelledby="tally-after">
        <h2 id="tally-after" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          {so && mode === "form" ? 2 : no(3)} · {so && mode === "form" ? "Preview and import" : so ? "Map the columns, validate and import" : "Review and import"}
        </h2>

        {file && def && !file.manual && (
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4">
            <div className="rounded-section bg-surface-card p-5" style={CARD_STYLE}>
              <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                File preview
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table aria-label="File preview" className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      <th className="px-2 py-1 font-semibold">Row</th>
                      {file.headers.map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {file.rows.slice(0, 8).map((r) => (
                      <tr key={r.rowNo} className="border-t border-hairline">
                        <td className="px-2 py-1 tabular-nums text-ink-subtle">{r.rowNo}</td>
                        {file.headers.map((_, i) => (
                          <td key={i} className="whitespace-nowrap px-2 py-1 text-ink-strong">
                            {r.cells[i] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-section bg-surface-card p-5" style={CARD_STYLE}>
              <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                Column mapping
              </h3>
              <p className="mt-1 text-[13px] text-ink-muted">Going to: {def.destination}. Suggestions come from the headings and your last import; correct anything that looks wrong.</p>
              {isOutstanding && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
                    Balances as of
                    <DateField aria-label="Balances as of" className={FIELD} value={asOfDate} onChange={(v) => (setAsOfDate(v), resetChecks())} />
                  </label>
                  <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
                    These are
                    <select aria-label="Direction" className={FIELD} value={direction} onChange={(e) => (setDirection(e.target.value as TallyDirection | ""), resetChecks())}>
                      <option value="">Choose…</option>
                      <option value="receivable">Receivable (customers owe us)</option>
                      <option value="payable">Payable (we owe vendors)</option>
                    </select>
                  </label>
                </div>
              )}
              {so ? (
                <SalesOrderMapping fields={soFields} catalogue={catalogue} headers={file.headers} mapping={mapping} onChange={setField} />
              ) : (
              <div className="mt-3 grid grid-cols-2 max-md:grid-cols-1 gap-x-6 gap-y-2">
                {def.fields.map((field) => (
                  <label key={field.key} className="flex items-center justify-between gap-3 text-[13px] text-ink-strong">
                    <span>
                      {field.label}
                      {field.required && <span className="ml-1 font-bold text-[#B91C1C]">*</span>}
                    </span>
                    <select aria-label={field.label} className={`${FIELD} w-[210px]`} value={mapping[field.key] ?? ""} onChange={(e) => setField(field.key, e.target.value)}>
                      <option value="">{field.required ? "Choose a column…" : "Not imported"}</option>
                      {file.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              )}
              {problems && !mappingOk && (
                <ul role="alert" className="mt-3 list-disc pl-5 text-[13px] font-semibold text-[#B91C1C]">
                  {problems.missingRequired.map((f) => (
                    <li key={f.key}>{f.label} is required and has no column.</li>
                  ))}
                  {problems.duplicated.map((c) => (
                    <li key={c}>&ldquo;{c}&rdquo; is mapped to more than one field.</li>
                  ))}
                  {problems.duplicateHeadings.map((h) => (
                    <li key={`dup-${h}`}>The file has more than one &ldquo;{h}&rdquo; column. Remove the extra one so it&apos;s clear which to read.</li>
                  ))}
                  {problems.incompatible.map((p) => (
                    <li key={p.field.key}>
                      &ldquo;{p.column}&rdquo; doesn&apos;t look like {p.field.label}.
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <button type="button" disabled={!canImport || !storageReady || !mappingOk || !settingsOk || busy} onClick={() => void validate()} className={PRIMARY} style={PRIMARY_STYLE}>
                  Validate
                </button>
              </div>
            </div>
          </div>
        )}

        {progress && (
          <p role="status" className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-strong">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            {progress.label}… part {progress.done} of {progress.total}
          </p>
        )}
        {problem && (
          <p role="alert" className="mt-3 text-[13px] font-semibold text-[#B91C1C]">
            {problem}
          </p>
        )}

        {orders && orderSummary && (
          <>
            <SalesOrderPreview
              views={orders}
              summary={orderSummary}
              matches={matches}
              links={links}
              options={{ customers: linkOptions?.customers ?? [], products: linkOptions?.products ?? [], ledgers: linkOptions?.ledgers ?? [] }}
              canMatch={canImport}
              stale={stale}
              busy={busy}
              onLink={setLink}
              onRevalidate={() => void (file?.manual ? validate({ file, mapping, links }) : validate())}
              onDownloadReport={downloadReport}
            />
            {(orderSummary.warnings > 0 || orderSummary.invalid > 0) && (
              <div className="mt-3 rounded-section bg-surface-card px-5 py-4" style={CARD_STYLE}>
                {orderSummary.warnings > 0 && (
                  <label className="flex items-center gap-2 text-[13px] text-ink-strong">
                    <input type="checkbox" checked={includeAttention} onChange={(e) => setIncludeAttention(e.target.checked)} />
                    Also import the {orderSummary.warnings} {orderSummary.warnings === 1 ? "order that has a warning" : "orders that have warnings"}
                  </label>
                )}
                {orderSummary.invalid > 0 && (
                  <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-strong">
                    <input type="checkbox" checked={ackInvalid} onChange={(e) => setAckInvalid(e.target.checked)} />
                    Leave out the {orderSummary.invalid} invalid {orderSummary.invalid === 1 ? "order" : "orders"}; record their rows as rejected in the history
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {summary && !so && (
          <div className="mt-4 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
            <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
              Validation summary
            </h3>
            <div className="mt-2 grid grid-cols-6 max-md:grid-cols-3 gap-2">
              <Tile label="Total rows" value={summary.total} />
              <Tile label="Valid" value={summary.valid} tone="#047857" />
              <Tile label="Invalid" value={summary.invalid} tone="#B91C1C" />
              <Tile label="Duplicate" value={summary.duplicate} />
              <Tile label="Attention" value={summary.attention} tone="#B45309" />
              <Tile label="Ready" value={summary.ready} tone="#047857" />
            </div>
            {flagged.length > 0 && (
              <div className="mt-3 max-h-[280px] overflow-y-auto">
                <table aria-label="Rows to review" className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      <th className="px-2 py-1 font-semibold">Row</th>
                      <th className="px-2 py-1 font-semibold">Result</th>
                      <th className="px-2 py-1 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.slice(0, 500).map((r) => (
                      <tr key={r.rowNo} className="border-t border-hairline align-top">
                        <td className="px-2 py-1 tabular-nums">{r.rowNo}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold">{STATE_LABEL[r.state]}</td>
                        <td className="px-2 py-1 text-ink-muted">{r.messages.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {flagged.length > 500 && <p className="mt-1 text-[12.5px] text-ink-subtle">Showing the first 500 of {flagged.length.toLocaleString("en-IN")} rows.</p>}
            {summary.attention > 0 && (
              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-strong">
                <input type="checkbox" checked={includeAttention} onChange={(e) => setIncludeAttention(e.target.checked)} />
                Also import the {summary.attention} rows that need attention
              </label>
            )}
            {summary.invalid > 0 && (
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-strong">
                <input type="checkbox" checked={ackInvalid} onChange={(e) => setAckInvalid(e.target.checked)} />
                Don&apos;t import the {summary.invalid} invalid rows; record them as rejected in the history
              </label>
            )}
          </div>
        )}

        {finished && (
          <div className="mt-4 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
            <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
              {so ? "Import result" : "Record counts"}
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">From the database, for this import ({finished.status}).</p>
            <div className={`mt-2 grid ${so ? "grid-cols-6 max-lg:grid-cols-3" : "grid-cols-5"} max-md:grid-cols-2 gap-2`}>
              {so && <Tile label="Sales orders created" value={createdOrders} tone="#047857" />}
              <Tile label="Rows read" value={finished.totalRows} />
              <Tile label="Accepted" value={finished.importedRows + finished.skippedRows} />
              <Tile label="Rejected" value={finished.rejectedRows} tone="#B91C1C" />
              <Tile label="Skipped" value={finished.skippedRows} />
              <Tile label="Imported" value={finished.importedRows} tone="#047857" />
            </div>
            {finished.failedRows > 0 && <p className="mt-2 text-[13px] font-semibold text-[#B91C1C]">{finished.failedRows} rows were not saved. Upload the same file again to retry only those.</p>}
            {so && (
              <p className="mt-3 text-[13px]">
                <Link href={DOCUMENT_SECTIONS["sales-orders"].href} className="font-bold underline-offset-2 hover:underline" style={{ color: SO_BLUE }}>
                  Open Sales Orders
                </Link>
                <span className="text-ink-subtle"> to see the imported orders with their product lines.</span>
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button type="button" disabled={!canRun} onClick={() => setConfirming(true)} className={PRIMARY} style={PRIMARY_STYLE}>
            Import
          </button>
          <span className="text-ink-subtle" style={{ fontSize: 12.5 }}>
            {importBlocked ? importBlocked : stale ? "The matches changed: validate again first." : checked ? "Nothing is written until you confirm." : "Enabled once the file has been validated."}
          </span>
        </div>

        <div className="mt-6 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
          <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Import history
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table aria-label="Import history" className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-left text-ink-subtle">
                  {["Batch", "File", lockedCategory ? "Orders" : "Category", "Period", "Uploaded by", "Uploaded", lockedCategory ? "Rows" : "Total", "Imported", "Skipped", "Failed", "Status", "Completed", ""].map((h) => (
                    <th key={h} className="px-2 py-1 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr className="border-t border-hairline">
                    <td colSpan={13} className="px-2 py-3 text-ink-subtle">
                      No imports yet.
                    </td>
                  </tr>
                )}
                {history.map((b) => (
                  <React.Fragment key={b.id}>
                    <tr className="border-t border-hairline">
                      <td className="px-2 py-1 font-mono text-[11.5px]" title={b.id}>
                        <Link href={`/forms/tally-import/batches/${b.id}` as Route} className="font-bold text-[#0B4FB8] underline-offset-2 hover:underline" aria-label={`Open batch ${b.id.slice(0, 8)}`}>
                          {b.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-2 py-1">{b.fileName}</td>
                      <td className="px-2 py-1 tabular-nums">{lockedCategory ? (b.documentCount ?? 0).toLocaleString("en-IN") : (TALLY_CATEGORIES[b.category as TallyCategoryKey]?.label ?? b.category)}</td>
                      <td className="whitespace-nowrap px-2 py-1">
                        {b.financialYears.length ? b.financialYears.join(", ") : b.asOfDate ? `As of ${fmtDate(b.asOfDate)}` : "—"}
                        {b.isHistorical ? " · historical" : ""}
                      </td>
                      <td className="px-2 py-1">{b.uploadedBy ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1">{when(b.createdAt)}</td>
                      <td className="px-2 py-1 tabular-nums">{b.totalRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.importedRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.skippedRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.rejectedRows + b.failedRows}</td>
                      <td className="px-2 py-1 font-semibold">{b.status}</td>
                      <td className="whitespace-nowrap px-2 py-1">{when(b.completedAt)}</td>
                      <td className="px-2 py-1">
                        <button type="button" className="font-bold text-[#0B4FB8]" onClick={() => showDetails(b.id)}>
                          Details
                        </button>
                      </td>
                    </tr>
                    {details?.id === b.id && (
                      <tr>
                        <td colSpan={13} className="px-2 py-2 text-ink-muted">
                          {details.rows.length === 0 ? "Every row imported." : details.rows.map((r) => <p key={r.rowNo}>Row {r.rowNo} · {r.status}: {r.reason}</p>)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <CenterDialog
        open={confirming}
        title={so ? "Import these sales orders?" : "Import these records?"}
        accentBar={so ? SO_ACCENT_BAR : FORMS_ACCENT_BAR}
        subtitle={file?.fileName}
        width={480}
        onClose={() => setConfirming(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong">
              Cancel
            </button>
            <button type="button" onClick={runImport} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white" style={{ background: so ? SO_ACCENT : FORMS_ACCENT }}>
              Confirm import
            </button>
          </div>
        }
      >
        {orderSummary ? (
          <p className="text-[14px] text-ink-strong">
            {orderSummary.ready.toLocaleString("en-IN")} {orderSummary.ready === 1 ? "sales order" : "sales orders"} with {orderSummary.readyLines.toLocaleString("en-IN")} product {orderSummary.readyLines === 1 ? "line" : "lines"} will be imported into{" "}
            {def?.destination}. Each order is saved whole or not at all. Existing orders are never overwritten, the Customer and Product Masters are not changed, and imported orders can&apos;t be removed from this page.
          </p>
        ) : (
          <p className="text-[14px] text-ink-strong">
            {summary?.ready.toLocaleString("en-IN")} rows will be imported into {def?.destination}. Existing records are never overwritten, and imported records can&apos;t be removed from this page.
          </p>
        )}
      </CenterDialog>
    </div>
  );
}

/** The server matched the form's customer or an item to another record than the one the person chose. */
function formMismatchOf(file: Loaded, matches: SalesOrderMatches | null): boolean {
  if (!file.manual || !matches) return false;
  const c = matches.customers.find((x) => x.key === file.manual!.customerKey);
  if (c?.ref && file.manual.customerId && c.ref !== file.manual.customerId) return true;
  return Object.entries(file.manual.products).some(([key, ref]) => {
    const pm = matches.products.find((x) => x.key === key);
    return !!pm?.ref && pm.ref !== ref;
  });
}

/**
 * The Sales Order column mapping, grouped by the matrix's own sections. A section with a required field that has no
 * column opens by itself; the rest stay folded. Columns of fields that aren't on under the configuration — a field
 * the matrix marks x that nobody enabled, an "Update" field, a field or section an administrator switched off — are
 * listed as ignored, and any other column no field reads is listed too, so nothing in the file goes unaccounted for.
 */
function SalesOrderMapping({ fields, catalogue, headers, mapping, onChange }: { fields: readonly TallyField[]; catalogue: SoCatalogue; headers: string[]; mapping: TallyMapping; onChange: (key: string, value: string) => void }) {
  const sections = catalogue.sections;
  const used = new Set(Object.values(mapping));
  const ignored = headers.filter((h, i) => !used.has(i) && ignoredHeading(catalogue, h));
  const unread = headers.filter((h, i) => !used.has(i) && !ignoredHeading(catalogue, h));
  const mapped = fields.filter((f) => mapping[f.key] !== undefined).length;
  return (
    <div className="mt-3">
      <p className="text-[12.5px] text-ink-muted">
        {mapped} of {fields.length} fields have a column. <span className="font-bold text-[#B91C1C]">*</span> = the column must be in the file (marked Y in Tally&apos;s matrix, with no condition).
      </p>
      <div className="mt-2 grid gap-2">
        {sections.map((section) => {
          const list = fields.filter((f) => f.section === section);
          if (!list.length) return null;
          const missing = list.filter((f) => f.required && mapping[f.key] === undefined).length;
          const have = list.filter((f) => mapping[f.key] !== undefined).length;
          return (
            <details key={section} open={missing > 0} className="rounded-lg" style={{ border: "1px solid var(--color-hairline)" }}>
              <summary className="cursor-pointer select-none px-3 py-2 text-[13px] font-bold text-ink-strong">
                {sectionLabel(catalogue, section)}{" "}
                <span className="font-semibold text-ink-subtle">
                  · {have}/{list.length}
                  {missing > 0 && <span className="text-[#B91C1C]"> · {missing} required without a column</span>}
                </span>
              </summary>
              <div className="grid grid-cols-2 max-md:grid-cols-1 gap-x-6 gap-y-2 px-3 pb-3">
                {list.map((field) => (
                  <label key={field.key} className="flex items-center justify-between gap-3 text-[13px] text-ink-strong">
                    <span className="min-w-0">
                      {field.label}
                      {field.required && <span className="ml-1 font-bold text-[#B91C1C]">*</span>}
                      {field.requirement === "conditional" && <span className="ml-1 text-[11px] font-bold text-[#0369A1]">?</span>}
                      {field.requirement === "provision" && <span className="ml-1 text-[11px] font-bold text-[#047857]">Provision</span>}
                    </span>
                    <select aria-label={field.label} className={`${FIELD} w-[210px] max-sm:w-[150px] shrink-0`} value={mapping[field.key] ?? ""} onChange={(e) => onChange(field.key, e.target.value)}>
                      <option value="">{field.required ? "Choose a column…" : "Not imported"}</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      {(ignored.length > 0 || unread.length > 0) && (
        <div className="mt-3 rounded-lg px-3 py-2 text-[12.5px] text-ink-muted" style={{ background: "#F6F8FB" }}>
          {ignored.length > 0 && (
            <p>
              <span className="font-bold text-ink-strong">Ignored ({ignored.length}):</span> {ignored.slice(0, 12).join(", ")}
              {ignored.length > 12 ? ` and ${ignored.length - 12} more` : ""} — not Sales Order fields in Tally&apos;s matrix, or switched off. An administrator can enable a field in Admin &amp; Master Setup → Sales Order Fields.
            </p>
          )}
          {unread.length > 0 && (
            <p className={ignored.length ? "mt-1" : ""}>
              <span className="font-bold text-ink-strong">Not read ({unread.length}):</span> {unread.slice(0, 12).join(", ")}
              {unread.length > 12 ? ` and ${unread.length - 12} more` : ""} — no field uses these columns.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
