"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ChevronDown, ChevronRight, Lock, Pencil, Plus, RotateCcw } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/dates";
import { MASTERS_GRADIENT, MASTERS_GRADIENT_BAR, MASTERS_INK } from "@/components/masters/theme";
import { SO_FIELD, SO_GROUP, SO_MARKINGS } from "@/lib/tally/sales-order-catalogue";
import {
  CUSTOM_TYPES,
  FIELD_SCOPES,
  HELP_TEXT_MAX,
  SCOPE_LABEL,
  SUPPORT_LABEL,
  baseRule,
  buildCatalogue,
  describeRule,
  isSectionKey,
  supportOf,
  validateSection,
  validateSetting,
  type Condition,
  type ConfiguredField,
  type ConfiguredSection,
  type FieldMarking,
  type FieldScope,
  type FieldSetting,
  type FieldStatus,
  type FieldSupport,
  type SectionInput,
  type SettingInput,
} from "@/lib/tally/sales-order-config";
import { saveSalesOrderField, saveSalesOrderSection } from "@/app/(masters)/master-setup/sales-order-fields/actions";

/**
 * Admin & Master Setup → Sales Order Fields. Every field of TallyPrime's Sales Order matrix (the Read Me worksheet's
 * 353, in its 38 sections) and every custom field and section, one card per section: each field with its original
 * marking, scope, type, requirement in words, where it is used and its display order. Fields are found by name and
 * narrowed by section, marking, scope, enabled / disabled and how far the WMS supports them.
 *
 * A field's dialog changes what a setting may change; locked fields only their label and order. A field marked x that
 * the WMS doesn't offer is a provision: disabled until it is enabled here, and it says plainly when the WMS only
 * records its value or when it can't be enabled until technical work is done. Sections are enabled, disabled,
 * relabelled, reordered and added here too. Nothing is ever deleted. Every save names the setting version it read;
 * the server re-validates it all.
 */

const BOX = "h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong disabled:bg-[#F6F8FB]";
const FIELD = `${BOX} w-full`;
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const TYPE_LABEL: Record<string, string> = { text: "Text", date: "Date", amount: "Amount (₹)", number: "Number", percent: "Percentage", yesno: "Yes / No", choice: "Choice from a list", gstin: "GSTIN", state: "State", pincode: "Pincode", hsn: "HSN/SAC code" };
const CONTROL_LABEL: Record<string, string> = { text: "Text box", date: "Date box", amount: "Number box", number: "Number box", percent: "Number box", yesno: "Yes / No buttons", choice: "Dropdown", gstin: "Text box (format checked)", state: "Dropdown in India, text elsewhere", pincode: "Text box (format checked)", hsn: "Text box (format checked)" };
const MARKING_TEXT: Record<FieldMarking, string> = { Y: "Marked Y", "?": "Marked ?", Provision: "Provision", x: "x in the matrix", Update: "Pre-close (Update)", Custom: "Custom" };
const MARKING_TONE: Record<FieldMarking, [string, string]> = { Y: ["#92400E", "#FEF3C7"], "?": ["#0369A1", "#E0F2FE"], Provision: ["#047857", "#ECFDF5"], x: ["#475569", "#F1F5F9"], Update: ["#B45309", "#FFFBEB"], Custom: ["#7C3AED", "#F5F3FF"] };
const SUPPORT_TONE: Record<FieldSupport, [string, string]> = { full: ["#047857", "#ECFDF5"], recordOnly: ["#B45309", "#FFFBEB"], needsWork: ["#B91C1C", "#FEF2F2"] };
const MARKINGS: readonly FieldMarking[] = [...SO_MARKINGS, "Custom"];

export interface HistoryEntry {
  version: number;
  fieldKey: string;
  action: string;
  changedBy: string | null;
  changedAt: string;
}

type Draft = SettingInput & { expectedRowVersion: number; optionsText: string; conditionValuesText: string; helpDraft: string };
type SectionDraft = SectionInput & { expectedRowVersion: number; helpDraft: string };

function draftOf(f: ConfiguredField | null, scope: FieldScope = "voucher", section = ""): Draft {
  const s = f?.setting ?? null;
  return {
    fieldKey: f?.key ?? null,
    isCustom: f ? f.isCustom : true,
    scope: f?.scope ?? scope,
    label: f ? (s?.label ?? (f.isCustom ? f.label : null)) : "",
    section: f ? (s?.section ?? (f.isCustom ? f.section : null)) : section,
    displayOrder: s?.displayOrder ?? null,
    requirement: s?.requirement ?? (f ? null : "optional"),
    condition: s?.condition ?? null,
    fieldType: f?.isCustom ? (s?.fieldType ?? "text") : f ? null : "text",
    options: s?.options ?? null,
    inForm: f?.inForm ?? true,
    inImport: f?.inImport ?? true,
    onOrderPage: f?.onOrderPage ?? true,
    // The field's own switch, not its section's.
    status: f?.ownStatus ?? "active",
    expectedRowVersion: s?.rowVersion ?? 0,
    optionsText: (s?.options ?? []).join("\n"),
    conditionValuesText: s?.condition && "values" in s.condition ? s.condition.values.join(", ") : "",
    helpDraft: f?.helpText ?? "",
  };
}

const sectionDraftOf = (s: ConfiguredSection | null): SectionDraft => ({
  name: s?.name ?? "",
  isNew: !s,
  label: s?.setting?.label ?? null,
  displayOrder: s?.setting?.displayOrder ?? null,
  status: s && !s.enabled ? "retired" : "active",
  expectedRowVersion: s?.setting?.rowVersion ?? 0,
  helpDraft: s?.helpText ?? "",
});

const Yes = ({ on }: { on: boolean }) => <span className={on ? "font-bold text-[#047857]" : "text-ink-subtle"}>{on ? "Yes" : "—"}</span>;
const Badge = ({ tone, title, children }: { tone: [string, string]; title?: string; children: React.ReactNode }) => (
  <span title={title} className="inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-bold" style={{ color: tone[0], background: tone[1] }}>
    {children}
  </span>
);
const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={onClick} className="rounded-pill px-3 py-1 text-[12.5px] font-bold" style={on ? { background: MASTERS_INK, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}>
    {children}
  </button>
);

export function SalesOrderFieldsManager({ settings, version, ready, helpTextReady = false, canManage, history }: { settings: FieldSetting[]; version: number; ready: boolean; helpTextReady?: boolean; canManage: boolean; history: HistoryEntry[] }) {
  const router = useRouter();
  const catalogue = React.useMemo(() => buildCatalogue(settings, version), [settings, version]);
  const [scope, setScope] = React.useState<FieldScope | "">("");
  const [marking, setMarking] = React.useState<FieldMarking | "">("");
  const [section, setSection] = React.useState("");
  const [status, setStatus] = React.useState<"" | "enabled" | "disabled">("");
  const [support, setSupport] = React.useState<FieldSupport | "">("");
  const [query, setQuery] = React.useState("");
  /** Sections the person opened or closed by hand; the rest follow the default (open when anything in them is enabled). */
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [sectionDraft, setSectionDraft] = React.useState<SectionDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const editable = ready && canManage;

  const q = query.trim().toLowerCase();
  const filtering = !!(scope || marking || section || status || support || q);
  const shown = catalogue.fields.filter(
    (f) =>
      (!scope || f.scope === scope) &&
      (!marking || f.marking === marking) &&
      (!section || f.section === section) &&
      (!status || (status === "enabled") === (f.status === "active")) &&
      (!support || supportOf(f) === support) &&
      (!q || `${f.label} ${f.tallyName} ${f.section} ${catalogue.sectionByName.get(f.section)?.label ?? ""}`.toLowerCase().includes(q)),
  );
  const current = draft?.fieldKey ? catalogue.byKey.get(draft.fieldKey) ?? null : null;
  const locked = current?.locked ?? false;
  const blocked = current?.dependency?.kind === "needsWork";
  const count = (test: (f: ConfiguredField) => boolean) => catalogue.fields.filter(test).length;
  const enabledCount = count((f) => f.status === "active");

  function input(d: Draft): SettingInput {
    const values = d.conditionValuesText.split(",").map((v) => v.trim()).filter(Boolean);
    let condition: Condition | null = null;
    if (d.requirement === "conditional" && d.condition) {
      condition = d.condition.op === "given" ? { op: "given", field: d.condition.field } : d.condition.op === "ledgerKind" ? { op: "ledgerKind", values: d.condition.values } : { op: d.condition.op, field: d.condition.field, values };
    }
    const options = d.isCustom ? (d.fieldType === "choice" ? d.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : null) : d.options;
    return { ...d, label: d.label?.trim() ? d.label.trim() : null, section: d.section?.trim() ? d.section.trim() : null, condition, options, ...(helpTextReady ? { helpText: d.helpDraft.trim() || null } : {}) };
  }
  const errors = draft ? validateSetting(input(draft), catalogue) : [];
  const sectionInput = (d: SectionDraft): SectionInput => ({ name: d.name.trim(), isNew: d.isNew, label: d.label?.trim() ? d.label.trim() : null, displayOrder: d.displayOrder, status: d.status, ...(helpTextReady ? { helpText: d.helpDraft.trim() || null } : {}) });
  const sectionErrors = sectionDraft ? (sectionDraft.name.trim() ? validateSection(sectionInput(sectionDraft), catalogue) : ["Name the section."]) : [];

  async function run(send: () => Promise<{ ok: true; version: number } | { ok: false; error: string }>, done: () => void) {
    setSaving(true);
    setProblem(null);
    try {
      const res = await send();
      if (!res.ok) return setProblem(res.error);
      fireToast({ message: `Saved — configuration version ${res.version}.`, type: "success" });
      done();
      router.refresh();
    } catch {
      setProblem("The setting could not be saved. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  const save = (d: Draft) =>
    run(() => {
      // The screen's own text boxes (allowed values, condition values, help text) become the setting; they are not sent themselves.
      const { optionsText: _o, conditionValuesText: _c, helpDraft: _h, expectedRowVersion, ...setting } = { ...d, ...input(d) };
      return saveSalesOrderField({ ...setting, expectedRowVersion });
    }, () => setDraft(null));

  const saveSection = (d: SectionDraft) => run(() => saveSalesOrderSection({ ...sectionInput(d), expectedRowVersion: d.expectedRowVersion }), () => setSectionDraft(null));

  const toggleField = (f: ConfiguredField) => void save({ ...draftOf(f), status: f.ownStatus === "active" ? "retired" : "active" });
  const toggleSection = (s: ConfiguredSection) => void saveSection({ ...sectionDraftOf(s), status: s.enabled ? "retired" : "active" });

  const conditionFields = draft ? catalogue.fields.filter((f) => f.status === "active" && f.key !== draft.fieldKey && (f.scope === draft.scope || f.scope === "voucher")) : [];
  const conditionOn = draft?.condition && draft.condition.op !== "ledgerKind" ? catalogue.byKey.get(draft.condition.field) : undefined;
  const historyName = (key: string) => (isSectionKey(key) ? `Section: ${catalogue.sectionList.find((s) => s.key === key)?.label ?? key}` : (catalogue.byKey.get(key)?.label ?? key));
  const helpNote = helpTextReady ? null : "Help text needs database update 0130; until it is applied, a field shows the catalogue's own description.";

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

      <section aria-label="Find fields" className="grid gap-2.5 rounded-section bg-white p-4" style={CARD}>
        <p className="text-[12.5px] text-ink-muted">
          <strong className="text-ink-strong">{catalogue.fields.length} fields</strong> in {catalogue.sectionList.length} sections · {enabledCount} enabled · {catalogue.fields.length - enabledCount} disabled. A field marked x in Tally&apos;s matrix is off until it is enabled here.
          <span className="ml-1">
            <Badge tone={SUPPORT_TONE.recordOnly}>Record only</Badge> = stored, imported and shown, nothing else. <Badge tone={SUPPORT_TONE.needsWork}>Needs technical work</Badge> = can&apos;t be enabled yet.
          </span>
        </p>
        <div role="group" aria-label="Filter by scope" className="flex flex-wrap gap-1.5">
          {(["", ...FIELD_SCOPES] as const).map((s) => (
            <Pill key={s || "all"} on={scope === s} onClick={() => setScope(s)}>
              {s ? SCOPE_LABEL[s] : "All fields"} · {s ? count((f) => f.scope === s) : catalogue.fields.length}
            </Pill>
          ))}
        </div>
        <div role="group" aria-label="Filter by original marking" className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-ink-subtle">Original marking</span>
          {(["", ...MARKINGS] as const).map((m) => (
            <Pill key={m || "all"} on={marking === m} onClick={() => setMarking(m)}>
              {m || "Any"}
              {m ? ` · ${count((f) => f.marking === m)}` : ""}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" aria-label="Find a field" placeholder="Find a field…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${BOX} w-[220px] max-sm:w-full`} />
          <select aria-label="Filter by section" className={`${BOX} w-[230px] max-sm:w-full`} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {catalogue.sectionList.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </select>
          <select aria-label="Filter by status" className={`${BOX} w-[190px] max-sm:w-full`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Enabled and disabled</option>
            <option value="enabled">Enabled only</option>
            <option value="disabled">Disabled only</option>
          </select>
          <select aria-label="Filter by support" className={`${BOX} w-[230px] max-sm:w-full`} value={support} onChange={(e) => setSupport(e.target.value as typeof support)}>
            <option value="">Any support level</option>
            {(Object.keys(SUPPORT_LABEL) as FieldSupport[]).map((k) => (
              <option key={k} value={k}>
                {SUPPORT_LABEL[k]} · {count((f) => supportOf(f) === k)}
              </option>
            ))}
          </select>
          {filtering && (
            <button type="button" onClick={() => (setScope(""), setMarking(""), setSection(""), setStatus(""), setSupport(""), setQuery(""))} className="h-9 rounded-lg px-3 text-[12.5px] font-bold" style={{ color: MASTERS_INK }}>
              Clear filters
            </button>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={!editable} onClick={() => (setProblem(null), setSectionDraft(sectionDraftOf(null)))} className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-hairline-strong bg-white px-4 text-[13px] font-bold text-ink-strong disabled:opacity-50">
              <Plus size={15} aria-hidden /> Add section
            </button>
            <button type="button" disabled={!editable} onClick={() => (setProblem(null), setDraft(draftOf(null, scope || "voucher", section)))} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              <Plus size={15} aria-hidden /> Add custom field
            </button>
          </span>
        </div>
        {filtering && (
          <p role="status" className="text-[12.5px] text-ink-muted">
            {shown.length} of {catalogue.fields.length} fields match.
          </p>
        )}
      </section>

      {catalogue.sectionList.map((sec) => {
        const all = catalogue.fields.filter((f) => f.section === sec.name);
        const fields = shown.filter((f) => f.section === sec.name);
        // With a filter on, only the sections that hold a match; without one, every section (an empty custom one too).
        if (filtering && !fields.length) return null;
        const on = all.filter((f) => f.status === "active").length;
        const open = toggled[sec.name] ?? (filtering || (sec.enabled && on > 0));
        return (
          <section key={sec.name} aria-label={sec.label} className={`rounded-section bg-white p-4 ${sec.enabled ? "" : "opacity-80"}`} style={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${sec.label}`} onClick={() => setToggled((t) => ({ ...t, [sec.name]: !open }))} className="inline-flex items-center gap-1.5 text-left">
                {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                <h2 className="font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                  {sec.label}
                </h2>
              </button>
              {sec.label !== sec.name && <span className="text-[11.5px] text-ink-subtle">Tally: {sec.name}</span>}
              {sec.isCustom && <Badge tone={MARKING_TONE.Custom}>Custom section</Badge>}
              {!sec.enabled && <Badge tone={SUPPORT_TONE.needsWork}>Section disabled</Badge>}
              <span className="text-[12px] text-ink-muted">
                {on} of {all.length} enabled · order {sec.displayOrder}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-1">
                <button type="button" disabled={!editable} aria-label={`Edit section ${sec.label}`} onClick={() => (setProblem(null), setSectionDraft(sectionDraftOf(sec)))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
                  <Pencil size={13} aria-hidden /> Edit section
                </button>
                {sec.fixedReason ? (
                  <span title={sec.fixedReason} className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-bold text-ink-subtle">
                    <Lock size={12} aria-hidden /> Always on
                  </span>
                ) : (
                  <button type="button" disabled={!editable || saving} aria-label={`${sec.enabled ? "Disable" : "Enable"} section ${sec.label}`} onClick={() => toggleSection(sec)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold text-ink-muted disabled:opacity-40">
                    {sec.enabled ? <Archive size={13} aria-hidden /> : <RotateCcw size={13} aria-hidden />} {sec.enabled ? "Disable section" : "Enable section"}
                  </button>
                )}
                <button type="button" disabled={!editable} aria-label={`New field in ${sec.label}`} onClick={() => (setProblem(null), setDraft(draftOf(null, scope || "voucher", sec.name)))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold text-ink-muted disabled:opacity-40">
                  <Plus size={13} aria-hidden /> Field
                </button>
              </span>
            </div>
            {sec.helpText && <p className="mt-1 text-[12.5px] text-ink-muted">{sec.helpText}</p>}
            {open && fields.length === 0 && <p className="mt-2 text-[12.5px] text-ink-subtle">No field in this section yet.</p>}
            {open && fields.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[12.5px]" style={{ minWidth: 960 }}>
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      {["Field", "Scope", "Type", "Requirement", "Form", "Import", "Order page", "Order", ""].map((h) => (
                        <th key={h} className="px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => {
                      const sup = supportOf(f);
                      const off = f.ownStatus !== "active";
                      return (
                        <tr key={f.key} className={`border-t border-hairline align-top ${f.status === "retired" ? "opacity-60" : ""}`}>
                          <td className="px-2 py-1.5">
                            <span className="font-semibold text-ink-strong" title={f.helpText ?? f.rule}>
                              {f.label}
                            </span>
                            {f.label !== f.tallyName && <span className="block text-[11.5px] text-ink-subtle">Tally: {f.tallyName}</span>}
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              <Badge tone={MARKING_TONE[f.marking]} title={f.isCustom ? "Added in Admin & Master Setup" : `The Read Me worksheet marks it ${f.marking} for Sales Orders`}>
                                {MARKING_TEXT[f.marking]}
                              </Badge>
                              {f.locked && (
                                <Badge tone={["#475569", "#F1F5F9"]}>
                                  <Lock size={10} aria-hidden /> Locked
                                </Badge>
                              )}
                              {f.group && (
                                <Badge tone={["#1D4ED8", "#EFF6FF"]} title={`A column of the ${SO_GROUP[f.group].rowLabel} rows, entered under each ${SO_GROUP[f.group].parent === "ledger" ? "ledger entry" : "order"}`}>
                                  Repeating rows
                                </Badge>
                              )}
                              {sup !== "full" && (
                                <Badge tone={SUPPORT_TONE[sup]} title={f.dependency!.text}>
                                  {SUPPORT_LABEL[sup]}
                                </Badge>
                              )}
                              {off && <Badge tone={SUPPORT_TONE.needsWork}>Disabled</Badge>}
                              {!off && f.sectionOff && <Badge tone={SUPPORT_TONE.needsWork}>Off: section disabled</Badge>}
                              {f.setting?.requirement && <Badge tone={["#0369A1", "#E0F2FE"]}>Changed from the matrix</Badge>}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">{SCOPE_LABEL[f.scope]}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{TYPE_LABEL[f.type] ?? f.type}</td>
                          <td className="px-2 py-1.5">{describeRule(f.requirementRule, catalogue)}</td>
                          <td className="px-2 py-1.5"><Yes on={f.inForm} /></td>
                          <td className="px-2 py-1.5"><Yes on={f.inImport} /></td>
                          <td className="px-2 py-1.5"><Yes on={f.onOrderPage} /></td>
                          <td className="px-2 py-1.5 tabular-nums">{f.displayOrder}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">
                            <button type="button" disabled={!editable} aria-label={`Edit ${f.label}`} onClick={() => (setProblem(null), setDraft(draftOf(f)))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold disabled:opacity-40" style={{ color: MASTERS_INK }}>
                              <Pencil size={13} aria-hidden /> Edit
                            </button>
                            {!f.locked && !f.workflow && sup !== "needsWork" && (
                              <button type="button" disabled={!editable || saving} aria-label={`${off ? "Enable" : "Disable"} ${f.label}`} onClick={() => toggleField(f)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-bold text-ink-muted disabled:opacity-40">
                                {off ? <RotateCcw size={13} aria-hidden /> : <Archive size={13} aria-hidden />} {off ? "Enable" : "Disable"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {filtering && shown.length === 0 && (
        <p className="rounded-section bg-white p-4 text-[13px] text-ink-muted" style={CARD}>
          No field matches these filters.
        </p>
      )}
      {problem && !draft && !sectionDraft && (
        <p role="alert" className="rounded-section px-5 py-3 text-[13px] font-semibold text-[#B91C1C]" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
          {problem}
        </p>
      )}

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
                <span className="font-mono text-ink-subtle">v{h.version}</span> · <span className="font-semibold text-ink-strong">{historyName(h.fieldKey)}</span> · {h.action === "retire" ? "disabled" : h.action === "restore" ? "enabled" : h.action} · {h.changedBy ?? "—"} · {fmtDateTime(h.changedAt)}
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
        width={680}
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
            {current && (
              <dl aria-label="About this field" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg p-3 text-[12.5px]" style={{ background: "#F6F8FB" }}>
                <dt className="font-semibold text-ink-muted">Original marking</dt>
                <dd className="text-ink-strong">{current.isCustom ? "Custom field (not in Tally's matrix)" : `${current.marking} in the Read Me worksheet${current.matrixRow ? `, row ${current.matrixRow}` : ""}`}</dd>
                <dt className="font-semibold text-ink-muted">Type and input</dt>
                <dd className="text-ink-strong">
                  {TYPE_LABEL[current.type] ?? current.type} · {CONTROL_LABEL[current.type] ?? "Text box"}
                  {!current.isCustom && " (set by Tally)"}
                </dd>
                <dt className="font-semibold text-ink-muted">What is checked</dt>
                <dd className="text-ink-strong">{current.rule}</dd>
                {current.dependency && (
                  <>
                    <dt className="font-semibold" style={{ color: SUPPORT_TONE[current.dependency.kind][0] }}>
                      WMS support
                    </dt>
                    <dd className="text-ink-strong">{current.dependency.text}</dd>
                  </>
                )}
                {current.group && (
                  <>
                    <dt className="font-semibold text-ink-muted">Repeating rows</dt>
                    <dd className="text-ink-strong">
                      A column of the {SO_GROUP[current.group].section} rows: each {SO_GROUP[current.group].parent === "ledger" ? "ledger entry" : "order"} can carry any number of {SO_GROUP[current.group].rowLabel}s. Its requirement applies to every row; its condition can read the same row, its {SO_GROUP[current.group].parent === "ledger" ? "ledger entry" : "order"} or the order. It stays in its section.
                    </dd>
                  </>
                )}
              </dl>
            )}
            <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Label
                <input aria-label="Label" className={FIELD} value={draft.label ?? ""} placeholder={current && !current.isCustom ? SO_FIELD[current.key]?.label : ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Section
                <input aria-label="Section" list="so-sections" className={FIELD} disabled={locked || !!current?.workflow || !!current?.group} value={draft.section ?? ""} placeholder={current?.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
                <datalist id="so-sections">
                  {catalogue.sectionList.map((s) => (
                    <option key={s.name} value={s.name} label={s.label !== s.name ? s.label : undefined} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Display order
                <input aria-label="Display order" inputMode="numeric" className={FIELD} value={draft.displayOrder ?? ""} placeholder={String(current?.displayOrder ?? "")} onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
              </label>
              {!locked && !current?.workflow && (
                <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                  Status
                  <select aria-label="Status" className={FIELD} disabled={blocked} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as FieldStatus })}>
                    <option value="active">Enabled</option>
                    <option value="retired">Disabled</option>
                  </select>
                </label>
              )}
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
                          {TYPE_LABEL[t]} — {CONTROL_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Help text
              <textarea aria-label="Help text" rows={2} maxLength={HELP_TEXT_MAX} disabled={!helpTextReady} className={`${FIELD} h-auto py-2`} value={draft.helpDraft} placeholder={current?.rule ?? "Shown with the field on the form"} onChange={(e) => setDraft({ ...draft, helpDraft: e.target.value })} />
              {helpNote && <span className="font-normal text-ink-subtle">{helpNote}</span>}
            </label>

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
                  <p className="text-[12.5px] text-ink-muted">Entered when pre-closing a delivery on an order&apos;s page, never on a new order or in an import. It can&apos;t be hidden or disabled.</p>
                ) : (
                <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                  <legend className="mb-1 text-[12px] font-semibold text-ink-muted">Used on (while enabled)</legend>
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

      <CenterDialog
        open={sectionDraft !== null}
        title={sectionDraft?.isNew ? "Add a section" : `Edit section ${catalogue.sectionByName.get(sectionDraft?.name ?? "")?.label ?? ""}`}
        subtitle={sectionDraft?.isNew ? "A section of your own, for custom fields or fields moved into it." : `Tally: ${sectionDraft?.name ?? ""}`}
        accentBar={MASTERS_GRADIENT_BAR}
        width={560}
        onClose={() => setSectionDraft(null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            {(problem || (sectionDraft && sectionErrors.length > 0 && sectionDraft.name.trim())) && <p role="alert" className="mr-auto text-[12.5px] font-semibold text-[#B91C1C]">{problem ?? sectionErrors.join(" ")}</p>}
            <button type="button" onClick={() => setSectionDraft(null)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong">
              Cancel
            </button>
            <button type="button" disabled={!sectionDraft || saving || sectionErrors.length > 0} onClick={() => sectionDraft && void saveSection(sectionDraft)} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              {saving ? "Saving…" : "Save section"}
            </button>
          </div>
        }
      >
        {sectionDraft && (() => {
          const sec = catalogue.sectionByName.get(sectionDraft.name) ?? null;
          return (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
                {sectionDraft.isNew ? (
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Section name
                    <input aria-label="Section name" className={FIELD} value={sectionDraft.name} onChange={(e) => setSectionDraft({ ...sectionDraft, name: e.target.value })} />
                  </label>
                ) : (
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Display label
                    <input aria-label="Section label" className={FIELD} value={sectionDraft.label ?? ""} placeholder={sectionDraft.name} onChange={(e) => setSectionDraft({ ...sectionDraft, label: e.target.value })} />
                  </label>
                )}
                <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                  Display order
                  <input aria-label="Section display order" inputMode="numeric" className={FIELD} value={sectionDraft.displayOrder ?? ""} placeholder={String(sec?.displayOrder ?? "after the others")} onChange={(e) => setSectionDraft({ ...sectionDraft, displayOrder: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
                </label>
                {!sectionDraft.isNew && (
                  <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                    Status
                    <select aria-label="Section status" className={FIELD} disabled={!!sec?.fixedReason} value={sectionDraft.status} onChange={(e) => setSectionDraft({ ...sectionDraft, status: e.target.value as FieldStatus })}>
                      <option value="active">Enabled</option>
                      <option value="retired">Disabled</option>
                    </select>
                  </label>
                )}
              </div>
              {sec?.fixedReason && <p className="text-[12.5px] text-ink-muted">This section is always on. {sec.fixedReason}</p>}
              {!sectionDraft.isNew && !sec?.fixedReason && <p className="text-[12.5px] text-ink-muted">Disabling a section switches its fields off on the form, in imports and in the template. Nothing stored on an order is removed, and enabling it again brings each field back as it was.</p>}
              <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                Help text
                <textarea aria-label="Section help text" rows={2} maxLength={HELP_TEXT_MAX} disabled={!helpTextReady} className={`${FIELD} h-auto py-2`} value={sectionDraft.helpDraft} onChange={(e) => setSectionDraft({ ...sectionDraft, helpDraft: e.target.value })} />
                {helpNote && <span className="font-normal text-ink-subtle">{helpNote}</span>}
              </label>
            </div>
          );
        })()}
      </CenterDialog>
    </div>
  );
}
