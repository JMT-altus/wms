"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, RotateCcw, Archive } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/dates";
import { MASTERS_GRADIENT, MASTERS_GRADIENT_BAR, MASTERS_INK } from "@/components/masters/theme";
import { SO_FIELD } from "@/lib/tally/sales-order-catalogue";
import {
  CUSTOM_TYPES,
  FIELD_SCOPES,
  SCOPE_LABEL,
  baseRule,
  buildCatalogue,
  describeRule,
  validateSetting,
  type Condition,
  type ConfiguredField,
  type FieldScope,
  type FieldSetting,
  type SettingInput,
} from "@/lib/tally/sales-order-config";
import { saveSalesOrderField } from "@/app/(masters)/master-setup/sales-order-fields/actions";

/**
 * Admin & Master Setup → Sales Order Fields. One table per section of TallyPrime's Sales Order matrix (and per custom
 * section): every field with its scope, its requirement in words, where it is used and its display order. A field's
 * dialog changes what a setting may change; locked fields only their label and order. Custom fields are added at any
 * scope and retired, never deleted. Every save names the setting version it read; the server re-validates it all.
 */

const FIELD = "h-9 w-full rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong disabled:bg-[#F6F8FB]";
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const TYPE_LABEL: Record<string, string> = { text: "Text", date: "Date", amount: "Amount (₹)", number: "Number", percent: "Percentage", yesno: "Yes / No", choice: "Choice from a list" };

export interface HistoryEntry {
  version: number;
  fieldKey: string;
  action: string;
  changedBy: string | null;
  changedAt: string;
}

type Draft = SettingInput & { expectedRowVersion: number; optionsText: string; conditionValuesText: string };

function draftOf(f: ConfiguredField | null, scope: FieldScope = "voucher"): Draft {
  const s = f?.setting ?? null;
  return {
    fieldKey: f?.key ?? null,
    isCustom: f ? f.isCustom : true,
    scope: f?.scope ?? scope,
    label: f ? (s?.label ?? (f.isCustom ? f.label : null)) : "",
    section: f ? (s?.section ?? (f.isCustom ? f.section : null)) : "",
    displayOrder: s?.displayOrder ?? null,
    requirement: s?.requirement ?? (f ? null : "optional"),
    condition: s?.condition ?? null,
    fieldType: f?.isCustom ? (s?.fieldType ?? "text") : f ? null : "text",
    options: s?.options ?? null,
    inForm: f?.inForm ?? true,
    inImport: f?.inImport ?? true,
    onOrderPage: f?.onOrderPage ?? true,
    status: f?.status ?? "active",
    expectedRowVersion: s?.rowVersion ?? 0,
    optionsText: (s?.options ?? []).join("\n"),
    conditionValuesText: s?.condition && "values" in s.condition ? s.condition.values.join(", ") : "",
  };
}

const Yes = ({ on }: { on: boolean }) => <span className={on ? "font-bold text-[#047857]" : "text-ink-subtle"}>{on ? "Yes" : "—"}</span>;

export function SalesOrderFieldsManager({ settings, version, ready, canManage, history }: { settings: FieldSetting[]; version: number; ready: boolean; canManage: boolean; history: HistoryEntry[] }) {
  const router = useRouter();
  const catalogue = React.useMemo(() => buildCatalogue(settings, version), [settings, version]);
  const [scope, setScope] = React.useState<FieldScope | "">("");
  const [query, setQuery] = React.useState("");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const editable = ready && canManage;

  const shown = catalogue.fields.filter((f) => (!scope || f.scope === scope) && (!query.trim() || `${f.label} ${f.tallyName} ${f.section}`.toLowerCase().includes(query.trim().toLowerCase())));
  const current = draft?.fieldKey ? catalogue.byKey.get(draft.fieldKey) ?? null : null;
  const locked = current?.locked ?? false;

  function input(d: Draft): SettingInput {
    const values = d.conditionValuesText.split(",").map((v) => v.trim()).filter(Boolean);
    let condition: Condition | null = null;
    if (d.requirement === "conditional" && d.condition) {
      condition = d.condition.op === "given" ? { op: "given", field: d.condition.field } : d.condition.op === "ledgerKind" ? { op: "ledgerKind", values: d.condition.values } : { op: d.condition.op, field: d.condition.field, values };
    }
    const options = d.isCustom ? (d.fieldType === "choice" ? d.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : null) : d.options;
    return { ...d, label: d.label?.trim() ? d.label.trim() : null, section: d.section?.trim() ? d.section.trim() : null, condition, options };
  }
  const errors = draft ? validateSetting(input(draft), catalogue) : [];

  async function save(d: Draft) {
    setSaving(true);
    setProblem(null);
    try {
      // The screen's own text boxes (allowed values, condition values) become the setting; they are not sent themselves.
      const { optionsText: _o, conditionValuesText: _c, expectedRowVersion, ...setting } = { ...d, ...input(d) };
      const res = await saveSalesOrderField({ ...setting, expectedRowVersion });
      if (!res.ok) return setProblem(res.error);
      fireToast({ message: `Saved — configuration version ${res.version}.`, type: "success" });
      setDraft(null);
      router.refresh();
    } catch {
      setProblem("The setting could not be saved. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRetired(f: ConfiguredField) {
    const d = draftOf(f);
    await save({ ...d, status: f.status === "active" ? "retired" : "active" });
  }

  const conditionFields = draft ? catalogue.fields.filter((f) => f.status === "active" && f.key !== draft.fieldKey && (f.scope === draft.scope || f.scope === "voucher")) : [];
  const conditionOn = draft?.condition && draft.condition.op !== "ledgerKind" ? catalogue.byKey.get(draft.condition.field) : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {!ready && (
        <div role="status" className="rounded-section px-5 py-4 text-[14px] text-ink-muted" style={{ background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">Database update 0128 needed.</strong> The Sales Order screens use TallyPrime&apos;s matrix as it is; settings can be saved once the update is applied.
        </div>
      )}
      {ready && !canManage && (
        <div role="note" className="rounded-section px-5 py-4 text-[14px] text-ink-muted" style={{ background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">View only.</strong> Changing Sales Order fields needs the &ldquo;Sales Order fields — Configure&rdquo; permission, which a super-admin grants in Field Permissions.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by scope" className="flex flex-wrap gap-1.5">
          {(["", ...FIELD_SCOPES] as const).map((s) => (
            <button key={s || "all"} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className="rounded-pill px-3 py-1 text-[12.5px] font-bold" style={scope === s ? { background: MASTERS_INK, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}>
              {s ? SCOPE_LABEL[s] : "All fields"} · {s ? catalogue.fields.filter((f) => f.scope === s).length : catalogue.fields.length}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Find a field" placeholder="Find a field…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${FIELD} ml-auto w-[220px] max-sm:w-full`} />
        <button type="button" disabled={!editable} onClick={() => (setProblem(null), setDraft(draftOf(null, scope || "voucher")))} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
          <Plus size={15} aria-hidden /> Add custom field
        </button>
      </div>

      {catalogue.sections.map((section) => {
        const fields = shown.filter((f) => f.section === section);
        if (!fields.length) return null;
        return (
          <section key={section} aria-label={section} className="rounded-section bg-white p-4" style={CARD}>
            <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
              {section}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ minWidth: 860 }}>
                <thead>
                  <tr className="text-left text-ink-subtle">
                    {["Field", "Scope", "Requirement", "Form", "Import", "Order page", "Order", ""].map((h) => (
                      <th key={h} className="px-2 py-1 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key} className={`border-t border-hairline align-top ${f.status === "retired" ? "opacity-60" : ""}`}>
                      <td className="px-2 py-1.5">
                        <span className="font-semibold text-ink-strong">{f.label}</span>
                        {f.label !== f.tallyName && <span className="block text-[11.5px] text-ink-subtle">Tally: {f.tallyName}</span>}
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {f.locked && <span className="inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-bold text-[#475569]" style={{ background: "#F1F5F9" }}><Lock size={10} aria-hidden /> Locked</span>}
                          {f.isCustom && <span className="rounded px-1 text-[10.5px] font-bold text-[#7C3AED]" style={{ background: "#F5F3FF" }}>Custom</span>}
                          {f.workflow && <span className="rounded px-1 text-[10.5px] font-bold text-[#B45309]" style={{ background: "#FFFBEB" }}>Pre-close (Update)</span>}
                          {f.outsideMatrix && f.keyed && <span className="rounded px-1 text-[10.5px] font-bold text-[#475569]" style={{ background: "#F1F5F9" }}>x in the matrix · optional</span>}
                          {f.status === "retired" && <span className="rounded px-1 text-[10.5px] font-bold text-[#B91C1C]" style={{ background: "#FEF2F2" }}>Retired</span>}
                          {f.setting?.requirement && <span className="rounded px-1 text-[10.5px] font-bold text-[#0369A1]" style={{ background: "#E0F2FE" }}>Changed from the matrix</span>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{SCOPE_LABEL[f.scope]}</td>
                      <td className="px-2 py-1.5">{describeRule(f.requirementRule, catalogue)}</td>
                      <td className="px-2 py-1.5"><Yes on={f.inForm} /></td>
                      <td className="px-2 py-1.5"><Yes on={f.inImport} /></td>
                      <td className="px-2 py-1.5"><Yes on={f.onOrderPage} /></td>
                      <td className="px-2 py-1.5 tabular-nums">{f.displayOrder}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <button type="button" disabled={!editable} aria-label={`Edit ${f.label}`} onClick={() => (setProblem(null), setDraft(draftOf(f)))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
                          <Pencil size={13} aria-hidden /> Edit
                        </button>
                        {!f.locked && !f.workflow && (
                          <button type="button" disabled={!editable || saving} aria-label={`${f.status === "active" ? "Retire" : "Restore"} ${f.label}`} onClick={() => void toggleRetired(f)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold text-ink-muted disabled:opacity-40">
                            {f.status === "active" ? <Archive size={13} aria-hidden /> : <RotateCcw size={13} aria-hidden />} {f.status === "active" ? "Retire" : "Restore"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section aria-label="Change history" className="rounded-section bg-white p-4" style={CARD}>
        <h2 className="mb-2 font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
          Change history
        </h2>
        {history.length === 0 ? (
          <p className="text-[13px] text-ink-subtle">No setting has been changed: every field follows TallyPrime&apos;s matrix.</p>
        ) : (
          <ul className="grid gap-1 text-[12.5px]">
            {history.map((h) => (
              <li key={h.version} className="text-ink-muted">
                <span className="font-mono text-ink-subtle">v{h.version}</span> · <span className="font-semibold text-ink-strong">{catalogue.byKey.get(h.fieldKey)?.label ?? h.fieldKey}</span> · {h.action} · {h.changedBy ?? "—"} · {fmtDateTime(h.changedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CenterDialog
        open={draft !== null}
        title={draft?.fieldKey ? `Edit ${current?.label ?? draft.fieldKey}` : "Add a custom field"}
        subtitle={current ? `Tally: ${current.tallyName} · ${SCOPE_LABEL[current.scope]}${locked ? " · locked: label and order only" : ""}` : "Its label is also its column heading in an import file."}
        accentBar={MASTERS_GRADIENT_BAR}
        width={640}
        onClose={() => setDraft(null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            {(problem || (draft && errors.length > 0)) && <p role="alert" className="mr-auto text-[12.5px] font-semibold text-[#B91C1C]">{problem ?? errors.join(" ")}</p>}
            <button type="button" onClick={() => setDraft(null)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong">
              Cancel
            </button>
            <button type="button" disabled={!draft || saving || errors.length > 0} onClick={() => draft && void save(draft)} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Label
                <input aria-label="Label" className={FIELD} value={draft.label ?? ""} placeholder={current && !current.isCustom ? SO_FIELD[current.key]?.label : ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Section
                <input aria-label="Section" list="so-sections" className={FIELD} disabled={locked || !!current?.workflow} value={draft.section ?? ""} placeholder={current?.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
                <datalist id="so-sections">
                  {catalogue.sections.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Display order
                <input aria-label="Display order" inputMode="numeric" className={FIELD} value={draft.displayOrder ?? ""} placeholder={String(current?.displayOrder ?? "")} onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
              </label>
              {draft.isCustom && !draft.fieldKey && (
                <>
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Scope
                    <select aria-label="Scope" className={FIELD} value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as FieldScope, condition: null })}>
                      {FIELD_SCOPES.map((s) => (
                        <option key={s} value={s}>
                          {SCOPE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Type
                    <select aria-label="Type" className={FIELD} value={draft.fieldType ?? "text"} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value as SettingInput["fieldType"] })}>
                      {CUSTOM_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            {!locked && (
              <>
                <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                  Requirement
                  <select aria-label="Requirement" className={FIELD} value={draft.requirement ?? ""} onChange={(e) => setDraft({ ...draft, requirement: (e.target.value || null) as Draft["requirement"], condition: e.target.value === "conditional" ? (draft.condition ?? { op: draft.scope === "ledger" ? "ledgerKind" : "given", ...(draft.scope === "ledger" ? { values: ["other"] } : { field: conditionFields[0]?.key ?? "" }) } as Condition) : null })}>
                    {!draft.isCustom && <option value="">As TallyPrime&apos;s matrix: {current ? describeRule(baseRule(current), catalogue) : ""}</option>}
                    <option value="mandatory">Mandatory</option>
                    <option value="optional">Optional</option>
                    {!current?.workflow && <option value="conditional">Mandatory only when…</option>}
                  </select>
                </label>
                {draft.requirement === "conditional" && draft.condition && (
                  <div className="grid grid-cols-[180px_1fr] max-sm:grid-cols-1 gap-2 rounded-lg p-3" style={{ background: "#F6F8FB" }}>
                    <select aria-label="Condition" className={FIELD} value={draft.condition.op} onChange={(e) => {
                      const op = e.target.value as Condition["op"];
                      setDraft({ ...draft, condition: op === "ledgerKind" ? { op, values: ["other"] } : op === "given" ? { op, field: conditionOn?.key ?? conditionFields[0]?.key ?? "" } : { op, field: conditionOn?.key ?? conditionFields[0]?.key ?? "", values: [] } });
                    }}>
                      <option value="in">when a field is one of…</option>
                      <option value="notIn">when a field is not one of…</option>
                      <option value="given">when a field is given</option>
                      {draft.scope === "ledger" && <option value="ledgerKind">on these ledger entries…</option>}
                    </select>
                    {draft.condition.op === "ledgerKind" ? (
                      <select aria-label="Ledger entries" className={FIELD} value={draft.condition.values.join(",")} onChange={(e) => setDraft({ ...draft, condition: { op: "ledgerKind", values: e.target.value.split(",") as ("customer" | "other")[] } })}>
                        <option value="customer,other">every ledger entry</option>
                        <option value="other">entries other than the customer&apos;s</option>
                        <option value="customer">the customer&apos;s entry only</option>
                      </select>
                    ) : (
                      <div className="grid gap-2">
                        <select aria-label="Condition field" className={FIELD} value={draft.condition.field} onChange={(e) => setDraft({ ...draft, condition: { ...(draft.condition as Exclude<Condition, { op: "ledgerKind" }>), field: e.target.value } })}>
                          {conditionFields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} ({SCOPE_LABEL[f.scope]})
                            </option>
                          ))}
                        </select>
                        {draft.condition.op !== "given" && (
                          <input aria-label="Condition values" className={FIELD} placeholder={conditionOn?.options ? `One or more of: ${conditionOn.options.join(", ")}` : "Values, separated by commas"} value={draft.conditionValuesText} onChange={(e) => setDraft({ ...draft, conditionValuesText: e.target.value })} />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {draft.isCustom && draft.fieldType === "choice" && (
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Allowed values (one per line)
                    <textarea aria-label="Allowed values" rows={4} className={`${FIELD} h-auto py-2`} value={draft.optionsText} onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })} />
                  </label>
                )}
                {!draft.isCustom && current?.key && SO_FIELD[current.key]?.options && (
                  <fieldset className="grid gap-1 text-[12.5px]">
                    <legend className="text-[12px] font-semibold text-ink-muted">Allowed values (TallyPrime&apos;s own; untick to restrict)</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {SO_FIELD[current.key]!.options!.map((o) => {
                        const on = !draft.options || draft.options.includes(o);
                        return (
                          <label key={o} className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={on} onChange={(e) => {
                              const all = SO_FIELD[current.key]!.options!;
                              const now = (draft.options ?? [...all]).filter((x) => x !== o).concat(e.target.checked ? [o] : []);
                              setDraft({ ...draft, options: now.length === all.length ? null : all.filter((x) => now.includes(x)) });
                            }} />
                            {o}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {current?.workflow ? (
                  <p className="text-[12.5px] text-ink-muted">Entered when pre-closing a delivery on an order&apos;s page, never on a new order or in an import. It can&apos;t be hidden or retired.</p>
                ) : (
                <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                  <legend className="mb-1 text-[12px] font-semibold text-ink-muted">Used on</legend>
                  {(["inForm", "inImport", "onOrderPage"] as const).map((k) => (
                    <label key={k} className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
                      {k === "inForm" ? "The entry form" : k === "inImport" ? "Excel/CSV import and template" : "The order page"}
                    </label>
                  ))}
                </fieldset>
                )}
              </>
            )}
          </div>
        )}
      </CenterDialog>
    </div>
  );
}
