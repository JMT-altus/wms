"use client";
import * as React from "react";
import { FileUp, Pencil, Play, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  IMPORT_SOURCES,
  IMPORT_SOURCE_LABELS,
  TALLY_MAPS_TO,
  TALLY_MAPS_TO_LABELS,
  type ImportSource,
  type ImportTarget,
  type TallyMapsTo,
} from "@/db/enums";
import type { CategoryRow, ImportBatchRow, TallyMappingRow } from "@/lib/queries/master-data";
import {
  deleteTallyMapping,
  runImport,
  saveTallyMapping,
} from "@/app/(masters)/master-setup/actions";
import { Dash, Pill } from "./data-table";
import {
  CancelButton,
  Drawer,
  Field,
  RowBtn,
  SaveButton,
  SelectInput,
  TextInput,
  Toggle,
} from "./drawer";

/** Fields an admin can map an incoming column onto, per target. */
const TARGET_FIELDS: Record<ImportTarget, { key: string; label: string; required?: boolean }[]> = {
  customers: [
    { key: "name", label: "Customer name", required: true },
    { key: "code", label: "Code" },
    { key: "customerCategory", label: "Customer category" },
    { key: "contactPerson", label: "Contact person" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "gstin", label: "GSTIN" },
    { key: "tallyGroup", label: "Tally group" },
  ],
  products: [
    { key: "name", label: "Product name", required: true },
    { key: "code", label: "Code" },
    { key: "brand", label: "Brand" },
    { key: "powerRating", label: "Power rating" },
    { key: "kvh", label: "KVH" },
    { key: "tallyName", label: "Tally name" },
  ],
  categories: [
    { key: "name", label: "Category name", required: true },
    { key: "code", label: "Code" },
  ],
  skus: [
    { key: "name", label: "SKU code", required: true },
    { key: "code", label: "Variant" },
  ],
};

/**
 * Minimal CSV parser — handles quoted fields, escaped quotes and CRLF, which
 * is all a Tally/Sheets export produces. Deliberately not a dependency: the
 * whole parser is ~30 lines and the alternative is shipping a library to the
 * browser for one admin screen.
 */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }

  const nonEmpty = out.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  // Strip a UTF-8 BOM off the first header or the mapper shows "﻿Name".
  const headers = nonEmpty[0]!.map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h).trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
  return { headers, rows };
}

/** Guess a mapping by loose header matching, so the common case is one click. */
function autoMap(headers: string[], target: ImportTarget): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const out: Record<string, string> = {};
  for (const field of TARGET_FIELDS[target]) {
    const hit = headers.find((h) => norm(h) === norm(field.key) || norm(h) === norm(field.label));
    if (hit) out[hit] = field.key;
  }
  // A sheet whose first column is "Particulars"/"Ledger" is the Tally shape.
  if (!Object.values(out).includes("name")) {
    const nameish = headers.find((h) =>
      ["name", "particulars", "ledger", "ledgername", "party", "customer", "item"].includes(norm(h)),
    );
    if (nameish) out[nameish] = "name";
  }
  return out;
}

export function ImportManager({
  batches,
  mappings,
  categories,
}: {
  batches: ImportBatchRow[];
  mappings: TallyMappingRow[];
  categories: CategoryRow[];
}) {
  const [tab, setTab] = React.useState<"import" | "tally">("import");
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {(
          [
            ["import", "Upload & map"],
            ["tally", `Tally groups · ${mappings.length}`],
          ] as ["import" | "tally", string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="rounded-pill px-4 py-2.5 font-bold"
            style={
              tab === id
                ? { fontSize: 14, background: "var(--color-ink-strong)", color: "#fff" }
                : {
                    fontSize: 14,
                    background: "var(--color-surface-card)",
                    color: "var(--color-ink-muted)",
                    border: "1px solid var(--color-hairline)",
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "import" ? (
        <UploadTab batches={batches} />
      ) : (
        <TallyTab mappings={mappings} categories={categories} />
      )}
    </div>
  );
}

function UploadTab({ batches }: { batches: ImportBatchRow[] }) {
  const [source, setSource] = React.useState<ImportSource>("csv");
  const [target, setTarget] = React.useState<ImportTarget>("customers");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCsv(String(reader.result ?? ""));
      if (h.length === 0) {
        toast.error("That file has no readable header row.");
        return;
      }
      setHeaders(h);
      setRows(r);
      setFileName(file.name);
      setMapping(autoMap(h, target));
      toast.success(`Loaded ${r.length} rows · ${h.length} columns`);
    };
    reader.readAsText(file);
  }

  const nameMapped = Object.values(mapping).includes("name");

  function apply() {
    if (!nameMapped) {
      toast.error("Map a column to the required name field first.");
      return;
    }
    start(async () => {
      const res = await runImport({ source, target, fileName, mapping, rows });
      if (res.ok) {
        toast.success(`Imported ${res.imported} · skipped ${res.skipped}`);
        setHeaders([]);
        setRows([]);
        setFileName(null);
        setMapping({});
      } else toast.error(res.error);
    });
  }

  return (
    <div className="grid gap-5">
      <section
        className="rounded-section bg-surface-card p-5"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          1 · Upload a dump
        </h2>
        <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
          A CSV exported from Google Sheets or Tally. Nothing is written until you press Import.
        </p>

        <div className="mt-4 grid grid-cols-3 max-md:grid-cols-1 gap-3">
          <Field label="Source">
            <SelectInput value={source} onChange={(e) => setSource(e.target.value as ImportSource)}>
              {IMPORT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {IMPORT_SOURCE_LABELS[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Import into">
            <SelectInput
              value={target}
              onChange={(e) => {
                const t = e.target.value as ImportTarget;
                setTarget(t);
                if (headers.length) setMapping(autoMap(headers, t));
              }}
            >
              <option value="customers">Customer masters</option>
              <option value="products">Product masters</option>
              <option value="categories">Product categories</option>
              <option value="skus">SKUs (mapping only)</option>
            </SelectInput>
          </Field>
          <Field label="File">
            <label
              className="flex items-center gap-2 rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline cursor-pointer text-ink-soft"
              style={{ fontSize: 14 }}
            >
              <Upload size={16} strokeWidth={2.3} />
              <span className="truncate">{fileName ?? "Choose CSV…"}</span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </label>
          </Field>
        </div>
      </section>

      {headers.length > 0 && (
        <>
          <section
            className="rounded-section bg-surface-card p-5"
            style={{ border: "1px solid var(--color-hairline)" }}
          >
            <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
              2 · Map the columns
            </h2>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
              Anything you leave unmapped is imported as <strong>blank</strong> — old records
              missing a sub-classification import fine rather than failing.
            </p>

            <div className="mt-4 grid grid-cols-2 max-md:grid-cols-1 gap-3">
              {headers.map((h) => (
                <div
                  key={h}
                  className="flex items-center gap-3 rounded-chip px-3.5 py-2.5 bg-surface-soft"
                  style={{ border: "1px solid var(--color-hairline)" }}
                >
                  <span className="font-bold text-ink-strong truncate" style={{ fontSize: 13.5, width: 150 }} title={h}>
                    {h}
                  </span>
                  <span className="text-ink-subtle">→</span>
                  <select
                    value={mapping[h] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (e.target.value === "") delete next[h];
                        else next[h] = e.target.value;
                        return next;
                      })
                    }
                    className="flex-1 rounded-chip px-3 h-9 bg-surface-card border border-hairline text-[13.5px] text-ink-strong outline-none"
                  >
                    <option value="">— ignore —</option>
                    {TARGET_FIELDS[target].map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " (required)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {!nameMapped && (
              <p
                className="mt-3 rounded-chip px-3.5 py-2.5 font-semibold"
                style={{
                  fontSize: 13.5,
                  background: "color-mix(in srgb, var(--color-red) 9%, transparent)",
                  color: "var(--color-red-deep)",
                  border: "1px solid color-mix(in srgb, var(--color-red) 26%, transparent)",
                }}
              >
                Map one column to the required name field — rows without it are skipped.
              </p>
            )}
          </section>

          <section
            className="rounded-section bg-surface-card p-5"
            style={{ border: "1px solid var(--color-hairline)" }}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
              <div>
                <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
                  3 · Preview &amp; import
                </h2>
                <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
                  First 5 of {rows.length} rows, as they will be stored.
                </p>
              </div>
              <button
                type="button"
                onClick={apply}
                disabled={pending || !nameMapped}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white font-bold disabled:opacity-50"
                style={{ fontSize: 15, background: "#0A6CFF" }}
              >
                <Play size={16} strokeWidth={2.5} />
                {pending ? "Importing…" : `Import ${rows.length} rows`}
              </button>
            </div>

            <div className="overflow-x-auto rounded-chip" style={{ border: "1px solid var(--color-hairline)" }}>
              <table className="w-full">
                <thead>
                  <tr className="text-left uppercase tracking-[0.08em] text-ink-subtle" style={{ fontSize: 11, fontWeight: 700 }}>
                    {TARGET_FIELDS[target].map((f) => (
                      <th key={f.key} className="px-3 py-2.5">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                      {TARGET_FIELDS[target].map((f) => {
                        const header = Object.entries(mapping).find(([, v]) => v === f.key)?.[0];
                        const val = header ? r[header] : "";
                        return (
                          <td key={f.key} className="px-3 py-2.5 text-ink-soft" style={{ fontSize: 13.5 }}>
                            {val ? val : <Dash />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section
        className="rounded-section bg-surface-card p-5"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <h2 className="font-bold text-ink-strong mb-3" style={{ fontSize: 17 }}>
          Import history
        </h2>
        {batches.length === 0 ? (
          <p className="text-ink-muted" style={{ fontSize: 14 }}>
            No imports yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left uppercase tracking-[0.08em] text-ink-subtle" style={{ fontSize: 11, fontWeight: 700 }}>
                  <th className="px-3 py-2.5">When</th>
                  <th className="px-3 py-2.5">Source</th>
                  <th className="px-3 py-2.5">Into</th>
                  <th className="px-3 py-2.5">File</th>
                  <th className="px-3 py-2.5 text-right">Rows</th>
                  <th className="px-3 py-2.5 text-right">Imported</th>
                  <th className="px-3 py-2.5 text-right">Skipped</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">By</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-3 py-2.5 text-ink-soft whitespace-nowrap" style={{ fontSize: 13.5 }}>
                      {b.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </td>
                    <td className="px-3 py-2.5 text-ink-soft" style={{ fontSize: 13.5 }}>
                      {IMPORT_SOURCE_LABELS[b.source as ImportSource] ?? b.source}
                    </td>
                    <td className="px-3 py-2.5 text-ink-soft" style={{ fontSize: 13.5 }}>{b.target}</td>
                    <td className="px-3 py-2.5 text-ink-soft truncate" style={{ fontSize: 13.5, maxWidth: 180 }}>
                      {b.fileName ?? <Dash />}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ fontSize: 13.5 }}>{b.rowCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ fontSize: 13.5 }}>{b.importedCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ fontSize: 13.5 }}>{b.skippedCount}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone={b.status === "applied" ? "green" : b.status === "failed" ? "red" : "slate"}>
                        {b.status}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-ink-soft" style={{ fontSize: 13.5 }}>{b.createdByName ?? <Dash />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TallyTab({
  mappings,
  categories,
}: {
  mappings: TallyMappingRow[];
  categories: CategoryRow[];
}) {
  const [editing, setEditing] = React.useState<TallyMappingRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  return (
    <>
      <section
        className="rounded-section bg-surface-card p-5"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
              Tally sub-group mapping
            </h2>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
              Where each Tally ledger group lands here. Sundry Debtors become customers; Sundry
              Creditors are suppliers and are not imported as customers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-pill px-4 h-10 text-[14px] font-bold text-white"
            style={{ background: "#0A6CFF" }}
          >
            <FileUp size={15} strokeWidth={2.5} />
            New mapping
          </button>
        </div>

        {mappings.length === 0 ? (
          <p className="text-ink-muted" style={{ fontSize: 14 }}>
            No mappings yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {mappings.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-chip px-4 py-3 bg-surface-soft"
                style={{ border: "1px solid var(--color-hairline)" }}
              >
                <span className="min-w-0">
                  <span className="font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                    {m.tallyGroup}
                  </span>
                  <span className="text-ink-subtle mx-2">→</span>
                  <Pill tone={m.mapsTo === "customer" ? "green" : m.mapsTo === "ignore" ? "slate" : "blue"}>
                    {TALLY_MAPS_TO_LABELS[m.mapsTo]}
                  </Pill>
                  {m.targetCategoryName && (
                    <span className="ml-2 text-ink-muted" style={{ fontSize: 13 }}>
                      · {m.targetCategoryName}
                    </span>
                  )}
                  {m.note && (
                    <p className="mt-1 text-ink-muted" style={{ fontSize: 12.5 }}>
                      {m.note}
                    </p>
                  )}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <RowBtn title="Edit" onClick={() => setEditing(m)}>
                    <Pencil size={14} strokeWidth={2.3} />
                  </RowBtn>
                  <RowBtn
                    title="Delete"
                    danger
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Delete mapping for "${m.tallyGroup}"?`)) return;
                      start(async () => {
                        const res = await deleteTallyMapping(m.id);
                        res.ok ? toast.success("Mapping deleted") : toast.error(res.error);
                      });
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2.3} />
                  </RowBtn>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <TallyForm
          row={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TallyForm({
  row,
  categories,
  onClose,
}: {
  row: TallyMappingRow | null;
  categories: CategoryRow[];
  onClose: () => void;
}) {
  const [f, setF] = React.useState({
    tallyGroup: row?.tallyGroup ?? "",
    mapsTo: (row?.mapsTo ?? "customer") as TallyMapsTo,
    targetCategoryId: row?.targetCategoryId ?? "",
    note: row?.note ?? "",
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveTallyMapping(row?.id ?? null, f);
      if (res.ok) {
        toast.success(row ? "Mapping updated" : "Mapping created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      title={row ? "Edit mapping" : "New Tally mapping"}
      subtitle="Map a Tally ledger group onto this system."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Tally group" required hint="Exactly as it appears in Tally.">
          <TextInput
            value={f.tallyGroup}
            onChange={(e) => set("tallyGroup", e.target.value)}
            required
            placeholder="e.g. Sundry Debtors"
          />
        </Field>
        <Field label="Maps to" required>
          <SelectInput value={f.mapsTo} onChange={(e) => set("mapsTo", e.target.value)}>
            {TALLY_MAPS_TO.map((t) => (
              <option key={t} value={t}>
                {TALLY_MAPS_TO_LABELS[t]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Target category" hint="Optional — leave blank if unknown.">
          <SelectInput
            value={f.targetCategoryId}
            onChange={(e) => set("targetCategoryId", e.target.value)}
          >
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Note">
          <TextInput value={f.note} onChange={(e) => set("note", e.target.value)} />
        </Field>
        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
