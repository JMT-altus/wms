"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { DateField } from "@/components/ui/date-field";
import { formatInrPaise } from "@/lib/format";
import { GST_STATES } from "@/lib/masters/gstin";
import { CHANGE_MODES, REGISTERED_TYPES, isIndia, soField, type SoField } from "@/lib/tally/sales-order-catalogue";
import { allocationAmountPaise, emptyItem, emptyLedger, emptySalesOrder, itemAmountPaise, orderTotals, singleDeliveryDiscountNote, type SoFormCostCentre, type SoFormItem, type SoFormLedger, type SoFormOrder } from "@/lib/tally/sales-order-form";
import type { LinkOption } from "@/components/forms/tally/sales-order-preview";
import { BASE_CATALOGUE, formFields, isRequired, type ConfiguredField, type FieldScope, type SoCatalogue } from "@/lib/tally/sales-order-config";

/**
 * Forms → Sales Orders → Import Sales Orders → "Enter an order". One Sales
 * Order, every field of Tally's Sales Order matrix (lib/tally/sales-order-
 * catalogue), laid out the way the order is built: voucher, buyer, consignee,
 * ledgers, items with their allocations and GST / HSN/SAC, dispatch, the
 * optional extras and the voucher states.
 *
 * Fields marked Y in the matrix carry a red star; those that apply only in
 * some cases (GST rates under "Specify Details Here", a GSTIN for a registered
 * buyer, a separate consignee) appear and are required only then. Fields
 * marked ? and Provision sit in collapsed "optional" panels, and so do the
 * fields the matrix marks x that the WMS offers (TallyExtras: whichever the
 * configuration has on the form, labelled as it says).
 *
 * Nothing here decides whether the order is valid: "Check order" turns the
 * form into the rows a template file would hold and sends them through the
 * same server validation, master matching and import as an uploaded file.
 */

const BLUE = "#0B4FB8";
const FIELD = "h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] text-ink-strong outline-none focus:border-[#0B4FB8] focus:ring-2 focus:ring-[#0B4FB8]/15 disabled:bg-[#F6F8FB]";
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 14px 32px -20px rgba(11, 79, 184, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const ok = "border-hairline-strong";
const bad = "border-[#DC2626] bg-[#FEF2F2]";

/** The matrix's Tally name of a field, the label every input carries. */
const tallyName = (key: string) => soField(key).tallyName;

/** The field configuration (Admin & Master Setup → Sales Order Fields) the form follows; TallyPrime's matrix as it is by default. */
const FormConfig = React.createContext<SoCatalogue>(BASE_CATALOGUE);

/**
 * Whether a matrix field is required on the form. A field an administrator changed follows its setting ("always" —
 * a conditional one is checked by the import, which knows the condition); otherwise the matrix's own Y.
 */
function requiredByConfig(c: SoCatalogue, key: string): boolean {
  const f = c.byKey.get(key);
  if (f?.setting?.requirement) return f.requirementRule.kind === "always" && !f.defaultsFrom;
  return soField(key).requirement === "mandatory";
}

function Label({ field, required, children, wide }: { field: SoField | string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  const c = React.useContext(FormConfig);
  const base = typeof field === "string" ? soField(field) : field;
  const cf = c.byKey.get(base.key);
  // A retired field, or one taken off the form, is not shown (its stored values stay on the orders that have them).
  if (cf && (cf.status !== "active" || !cf.inForm)) return null;
  const f = { ...base, label: cf?.label ?? base.label };
  const changed = !!cf?.setting?.requirement || !!cf?.isCustom;
  const star = required ?? (changed ? cf!.requirementRule.kind === "always" && !cf!.defaultsFrom : f.requirement === "mandatory" && !f.mandatoryWhen && !f.notEnforced);
  const conditional = changed ? cf!.requirementRule.kind === "when" : f.requirement === "conditional";
  return (
    <label className={`grid min-w-0 gap-1 text-[12px] font-semibold text-ink-muted ${wide ? "col-span-2 max-sm:col-span-1" : ""}`}>
      <span className="truncate" title={f.tallyName}>
        {f.label}
        {star && <span className="ml-0.5 text-[#B91C1C]">*</span>}
        {conditional && <span className="ml-1 rounded px-1 text-[10.5px] font-bold text-[#0369A1]" style={{ background: "#E0F2FE" }}>?</span>}
        {!changed && f.requirement === "provision" && <span className="ml-1 rounded px-1 text-[10.5px] font-bold text-[#047857]" style={{ background: "#ECFDF5" }}>Optional</span>}
      </span>
      {children}
    </label>
  );
}

function Section({ letter, title, hint, optional, defaultOpen = true, children }: { letter: string; title: string; hint?: string; optional?: boolean; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <section className="rounded-section bg-white" style={CARD} aria-labelledby={id}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[12px] font-extrabold text-white" style={{ background: BLUE }}>
          {letter}
        </span>
        <span id={id} className="min-w-0 flex-1 font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
          {title}
          {optional && <span className="ml-2 align-middle text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Optional</span>}
          {hint && <span className="block text-[12px] font-normal text-ink-muted">{hint}</span>}
        </span>
        {open ? <ChevronDown size={17} className="text-ink-subtle" aria-hidden /> : <ChevronRight size={17} className="text-ink-subtle" aria-hidden />}
      </button>
      {open && <div className="border-t border-hairline px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

/** A small collapsed panel inside a section, for the ? and Provision fields. */
function More({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="mt-3 rounded-lg" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px] font-bold" style={{ color: BLUE }}>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        {label}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

const Grid = ({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={`grid gap-x-3 gap-y-2.5 ${cols === 4 ? "grid-cols-4 max-lg:grid-cols-2" : cols === 3 ? "grid-cols-3 max-lg:grid-cols-2" : "grid-cols-2"} max-sm:grid-cols-1`}>{children}</div>
);

function TextBox({ value, onChange, invalid, ariaLabel, placeholder, disabled, list, inputMode }: { value: string; onChange: (v: string) => void; invalid?: boolean; ariaLabel: string; placeholder?: string; disabled?: boolean; list?: string; inputMode?: "decimal" | "numeric" }) {
  return <input aria-label={ariaLabel} aria-invalid={invalid || undefined} className={`${FIELD} ${invalid ? bad : ok}`} value={value} placeholder={placeholder} disabled={disabled} list={list} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />;
}

function Choice({ field, value, onChange, invalid, ariaLabel, disabled }: { field: SoField; value: string; onChange: (v: string) => void; invalid?: boolean; ariaLabel?: string; disabled?: boolean }) {
  return (
    <select aria-label={ariaLabel ?? field.tallyName} aria-invalid={invalid || undefined} className={`${FIELD} ${invalid ? bad : ok}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {field.options!.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function YesNo({ value, onChange, ariaLabel, invalid, disabled }: { value: string; onChange: (v: string) => void; ariaLabel: string; invalid?: boolean; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-invalid={invalid || undefined} className={`inline-flex h-9 w-full overflow-hidden rounded-lg border ${invalid ? "border-[#DC2626]" : "border-hairline-strong"}`}>
      {(["Yes", "No"] as const).map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} disabled={disabled} onClick={() => onChange(o)} className="flex-1 text-[13px] font-semibold" style={value === o ? { background: BLUE, color: "#fff" } : { background: "#fff", color: "var(--color-ink-muted)" }}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** The official GST state list in India; free text elsewhere (the country decides). */
function StateBox({ value, onChange, country, ariaLabel, invalid, disabled }: { value: string; onChange: (v: string) => void; country: string; ariaLabel: string; invalid?: boolean; disabled?: boolean }) {
  if (!isIndia(country)) return <TextBox ariaLabel={ariaLabel} value={value} onChange={onChange} invalid={invalid} disabled={disabled} />;
  return (
    <select aria-label={ariaLabel} aria-invalid={invalid || undefined} className={`${FIELD} ${invalid ? bad : ok}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {GST_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

const blank = (v: string | undefined) => !(v ?? "").trim();
const money = (paise: number) => formatInrPaise(paise);

const CUSTOM_INPUT_MODE: Partial<Record<string, "decimal" | "numeric">> = { amount: "decimal", number: "decimal", percent: "decimal" };

/** One configured field's input, by its type: Yes/No, a date, a list of values, or text. */
function TypedInput({ f, value, onChange, aria, invalid, disabled }: { f: ConfiguredField; value: string; onChange: (value: string) => void; aria: string; invalid: boolean; disabled: boolean }) {
  if (f.type === "yesno") return <YesNo ariaLabel={aria} value={value} onChange={onChange} invalid={invalid} disabled={disabled} />;
  if (f.type === "date") return <DateField aria-label={aria} className={`${FIELD} ${invalid ? bad : ok} tabular-nums`} value={value} onChange={onChange} disabled={disabled} />;
  if (f.options?.length)
    return (
      <select aria-label={aria} className={`${FIELD} ${invalid ? bad : ok}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  return <TextBox ariaLabel={aria} inputMode={CUSTOM_INPUT_MODE[f.type]} value={value} onChange={onChange} invalid={invalid} disabled={disabled} />;
}

/** The custom fields of one scope (one order, ledger entry, product line, allocation or additional cost), by their configured type. */
function CustomFields({ scope, values, onChange, owner, tried, disabled }: { scope: FieldScope; values: Record<string, string> | undefined; onChange: (key: string, value: string) => void; owner: string; tried: boolean; disabled: boolean }) {
  const c = React.useContext(FormConfig);
  const fields = formFields(c, scope).filter((f) => f.isCustom);
  if (!fields.length) return null;
  return (
    <>
      {fields.map((f) => (
        <Label key={f.key} field={f}>
          <TypedInput f={f} aria={`${f.label} of ${owner}`} value={values?.[f.key] ?? ""} onChange={(x) => onChange(f.key, x)} invalid={tried && f.requirementRule.kind === "always" && blank(values?.[f.key])} disabled={disabled} />
        </Label>
      ))}
    </>
  );
}

/**
 * The fields the matrix marks x that the WMS offers (keyed matrix fields), of one scope and Tally section, in a
 * collapsed panel titled with their configured labels. Only those the configuration has on the form, and only while
 * their condition holds (Voucher Applicable Upto for an optional voucher; cess under "Specify Details Here").
 * Optional by default; a field an administrator made mandatory is starred, checked and opens the panel.
 */
function TallyExtras({ scope, section, title, values, valueOf, onChange, owner, tried, disabled }: { scope: FieldScope; section: string; title: string; values: Record<string, string> | undefined; valueOf: (key: string) => string | null | undefined; onChange: (key: string, value: string) => void; owner: string; tried: boolean; disabled: boolean }) {
  const c = React.useContext(FormConfig);
  const read = (k: string) => values?.[k] ?? valueOf(k) ?? null;
  const fields = formFields(c, scope).filter((f) => f.keyed && !f.isCustom && soField(f.key).section === section && (!f.shownWhen || f.shownWhen.values.some((x) => x.toLowerCase() === (read(f.shownWhen!.field) ?? "").trim().toLowerCase())));
  if (!fields.length) return null;
  const required = (f: ConfiguredField) => isRequired(f, read);
  const anyRequired = fields.some(required);
  return (
    <More label={`${title} — ${fields.map((f) => f.label).join(", ")}${anyRequired ? "" : " (optional)"}`} defaultOpen={anyRequired}>
      <Grid cols={4}>
        {fields.map((f) => (
          <Label key={f.key} field={f} required={required(f)}>
            <TypedInput f={f} aria={`${f.label} of ${owner}`} value={values?.[f.key] ?? ""} onChange={(x) => onChange(f.key, x)} invalid={tried && required(f) && blank(values?.[f.key])} disabled={disabled} />
          </Label>
        ))}
      </Grid>
    </More>
  );
}

export interface SalesOrderEntryFormProps {
  options: { customers: LinkOption[]; products: LinkOption[]; ledgers: LinkOption[] };
  /** No import permission, or the database isn't ready: the form can be read but not checked. */
  disabled: boolean;
  busy: boolean;
  /** Messages from the last check, against the part of the form they belong to. */
  problems: { where: string; text: string }[];
  onCheck: (order: SoFormOrder) => void;
  /** The Customer Master's details for a chosen customer (to start the buyer's details from). */
  /** The field configuration to follow; TallyPrime's matrix as it is when not given. */
  catalogue?: SoCatalogue;
  loadCustomer: (id: string) => Promise<{ name: string; gstin: string | null; state: string | null; country: string | null; registrationType: string | null; address: string | null; pincode: string | null } | null>;
}

export function SalesOrderEntryForm({ catalogue = BASE_CATALOGUE, ...props }: SalesOrderEntryFormProps) {
  return (
    <FormConfig.Provider value={catalogue}>
      <EntryForm {...props} catalogue={catalogue} />
    </FormConfig.Provider>
  );
}

function EntryForm({ options, disabled, busy, problems, onCheck, loadCustomer, catalogue }: SalesOrderEntryFormProps & { catalogue: SoCatalogue }) {
  const [order, setOrder] = React.useState<SoFormOrder>(emptySalesOrder);
  const [tried, setTried] = React.useState(false);
  const [filledFrom, setFilledFrom] = React.useState<string | null>(null);
  const ledgerListId = React.useId();
  const v = order.voucher;
  const totals = orderTotals(order);

  const setVoucher = (key: string, value: string) => setOrder((o) => ({ ...o, voucher: { ...o.voucher, [key]: value } }));
  const voucherBox = (key: string) => <TextBox ariaLabel={tallyName(key)} value={v[key] ?? ""} onChange={(x) => setVoucher(key, x)} invalid={tried && requiredByConfig(catalogue, key) && blank(v[key])} disabled={disabled} />;
  const need = (key: string, value: string | undefined, required = true) => tried && required && blank(value);
  const registered = (REGISTERED_TYPES as readonly string[]).includes(v.buyerRegType ?? "");
  /** Whether a field is required now: its configured rule (always, never, or while its condition holds) on these values. */
  const ruleNow = (key: string, valueOf: (k: string) => string | null | undefined) => {
    const f = catalogue.byKey.get(key);
    return !!f && f.status === "active" && isRequired(f, (k) => valueOf(k) ?? null);
  };

  async function chooseCustomer(id: string) {
    const opt = options.customers.find((c) => c.value === id);
    setOrder((o) => ({ ...o, customerId: id, customerName: opt?.name ?? "" }));
    setFilledFrom(null);
    if (!id) return;
    const c = await loadCustomer(id).catch(() => null);
    if (!c) return;
    const reg = /^regular$/i.test(c.registrationType ?? "") ? "Regular" : /^composition$/i.test(c.registrationType ?? "") ? "Composition" : /unregistered|consumer/i.test(c.registrationType ?? "") ? "Unregistered/Consumer" : "";
    // The buyer's details start from the Customer Master and stay editable: nothing is sent until it is checked.
    setOrder((o) => ({
      ...o,
      voucher: {
        ...o.voucher,
        buyerBillTo: c.name,
        buyerMailingName: c.name,
        buyerAddress: c.address ?? "",
        buyerCountry: c.country || "India",
        buyerState: c.state ?? "",
        placeOfSupply: c.state ?? "",
        buyerPincode: c.pincode ?? "",
        buyerRegType: reg,
        gstin: c.gstin ?? "",
      },
    }));
    setFilledFrom(c.name);
  }

  const setItem = (i: number, f: (item: SoFormItem) => SoFormItem) => setOrder((o) => ({ ...o, items: o.items.map((it, j) => (j === i ? f(it) : it)) }));
  function setItemValue(i: number, key: string, value: string) {
    setItem(i, (it) => {
      const values = { ...it.values, [key]: value };
      // Taxable Value follows the Item Amount until someone types a different one.
      const before = itemAmountPaise(it.values);
      const after = itemAmountPaise(values);
      const shown = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));
      if (key !== "taxableValue" && (blank(it.values.taxableValue) || it.values.taxableValue === shown(before))) values.taxableValue = shown(after);
      return { ...it, values };
    });
  }
  function chooseProduct(i: number, ref: string) {
    const p = options.products.find((x) => x.value === ref);
    setItem(i, (it) => ({ ...it, productRef: ref, itemName: p?.name ?? "", values: { ...it.values, ratePer: it.values.ratePer || p?.unit || "" } }));
  }
  const setAlloc = (i: number, j: number, key: string, value: string) => setItem(i, (it) => ({ ...it, allocations: it.allocations.map((a, k) => (k === j ? { ...a, [key]: value } : a)) }));
  function copyTaxToAll(i: number) {
    const src = order.items[i]!.values;
    const keys = ["gstRateDetails", "gstSource", "gstSourceType", "gstTaxability", "gstNature", "gstClassification", "igstRate", "cgstRate", "sgstRate", "cessRate", "cessPerUnit", "stateCessRate", "gstOnMrp", "reverseCharge", "itcEligible", "hsnDetails", "hsnSource", "hsnSourceType", "hsnClassification", "hsn", "hsnDescription"];
    setOrder((o) => ({ ...o, items: o.items.map((it, j) => (j === i ? it : { ...it, values: { ...it.values, ...Object.fromEntries(keys.map((k) => [k, src[k] ?? ""])) } })) }));
  }
  const setLedger = (i: number, patch: Partial<SoFormLedger>) => setOrder((o) => ({ ...o, ledgers: o.ledgers.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  function check() {
    setTried(true);
    onCheck(order);
  }

  const costCentres = (list: SoFormCostCentre[], set: (next: SoFormCostCentre[]) => void, owner: string) => (
    <More label={`Cost centre allocations of ${owner} (?)${list.length ? ` · ${list.length}` : ""}`}>
      {list.map((c, k) => (
        <div key={k} className="mb-2 grid grid-cols-[1fr_1fr_140px_auto] max-sm:grid-cols-1 items-end gap-2">
          <Label field="categoryName">
            <TextBox ariaLabel={`${tallyName("categoryName")} ${k + 1} of ${owner}`} value={c.category} onChange={(x) => set(list.map((y, m) => (m === k ? { ...y, category: x } : y)))} disabled={disabled} />
          </Label>
          <Label field="costCentre" required>
            <TextBox ariaLabel={`${tallyName("costCentre")} ${k + 1} of ${owner}`} value={c.costCentre} onChange={(x) => set(list.map((y, m) => (m === k ? { ...y, costCentre: x } : y)))} invalid={need("", c.costCentre)} disabled={disabled} />
          </Label>
          <Label field="costCentreAmount" required>
            <TextBox ariaLabel={`${tallyName("costCentreAmount")} ${k + 1} of ${owner}`} inputMode="decimal" value={c.amount} onChange={(x) => set(list.map((y, m) => (m === k ? { ...y, amount: x } : y)))} invalid={need("", c.amount)} disabled={disabled} />
          </Label>
          <button type="button" aria-label={`Remove cost centre ${k + 1} of ${owner}`} disabled={disabled} onClick={() => set(list.filter((_, m) => m !== k))} className="mb-1 grid h-8 w-8 place-items-center rounded-md text-ink-subtle hover:bg-white hover:text-[#B91C1C]">
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      ))}
      <button type="button" disabled={disabled} onClick={() => set([...list, { category: "", costCentre: "", amount: "" }])} className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: BLUE }}>
        <Plus size={14} aria-hidden /> Add cost centre
      </button>
    </More>
  );

  /** The rate, narration and description every ledger entry carries (Y). */
  const entryFields = (l: { rate: string; narration: string; description: string; custom?: Record<string, string> }, set: (patch: Partial<SoFormLedger>) => void, owner: string) => (
    <>
      <Label field="ledgerRate">
        <TextBox ariaLabel={`${tallyName("ledgerRate")} of ${owner}`} inputMode="decimal" value={l.rate} onChange={(x) => set({ rate: x })} invalid={need("", l.rate)} placeholder="0 where it has none" disabled={disabled} />
      </Label>
      <Label field="ledgerNarration">
        <TextBox ariaLabel={`${tallyName("ledgerNarration")} of ${owner}`} value={l.narration} onChange={(x) => set({ narration: x })} invalid={need("", l.narration)} disabled={disabled} />
      </Label>
      <Label field="ledgerDescription">
        <TextBox ariaLabel={`${tallyName("ledgerDescription")} of ${owner}`} value={l.description} onChange={(x) => set({ description: x })} invalid={need("", l.description)} disabled={disabled} />
      </Label>
      <CustomFields scope="ledger" values={l.custom} onChange={(k, x) => set({ custom: { ...l.custom, [k]: x } })} owner={owner} tried={tried} disabled={disabled} />
    </>
  );

  const consigneeKeys = ["consignee", "consigneeMailingName", "consigneeAddressType", "consigneeAddress", "consigneeCountry", "consigneeState", "consigneeGstin", "consigneePincode"];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Enter a Sales Order">
      <datalist id={ledgerListId}>
        {options.ledgers.map((l) => (
          <option key={l.value} value={l.value} />
        ))}
      </datalist>

      <Section letter="A" title="Voucher and order" hint="General Details, Order Details and Type of Supply">
        <Grid cols={4}>
          <Label field="voucherType">{voucherBox("voucherType")}</Label>
          <Label field="documentDate">
            <DateField aria-label={tallyName("documentDate")} className={`${FIELD} ${need("", v.documentDate) ? bad : ok} tabular-nums`} value={v.documentDate ?? ""} onChange={(x) => setVoucher("documentDate", x)} disabled={disabled} />
          </Label>
          <Label field="documentNo">{voucherBox("documentNo")}</Label>
          <Label field="gstRegistration">{voucherBox("gstRegistration")}</Label>
          <Label field="costCentreClass">{voucherBox("costCentreClass")}</Label>
          <Label field="supplyType">{voucherBox("supplyType")}</Label>
          <Label field="narration" wide>
            {voucherBox("narration")}
          </Label>
          <Label field="referenceNo">{voucherBox("referenceNo")}</Label>
          <Label field="orderDate">
            <DateField aria-label={tallyName("orderDate")} className={`${FIELD} ${need("", v.orderDate) ? bad : ok} tabular-nums`} value={v.orderDate ?? ""} onChange={(x) => setVoucher("orderDate", x)} disabled={disabled} />
          </Label>
          <Label field="paymentTerms">{voucherBox("paymentTerms")}</Label>
          <Label field="otherReferences">{voucherBox("otherReferences")}</Label>
          <Label field="deliveryTerms" wide>
            {voucherBox("deliveryTerms")}
          </Label>
        </Grid>
        <More label="More voucher details — Voucher Number Series Name (?), Voucher Class, Price Level">
          <Grid>
            <Label field="seriesName">{voucherBox("seriesName")}</Label>
            <Label field="voucherClass">{voucherBox("voucherClass")}</Label>
            <Label field="priceLevel">{voucherBox("priceLevel")}</Label>
          </Grid>
        </More>
        <TallyExtras scope="voucher" section="General Details" title="Other voucher details" values={v} valueOf={(k) => v[k]} onChange={setVoucher} owner="the order" tried={tried} disabled={disabled} />
      </Section>

      <Section letter="B" title="Buyer / Supplier" hint="Party Details (Buyer/Supplier). Choosing the customer fills these from the Customer Master; check and edit them.">
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-1">
          <span className="text-[12px] font-semibold text-ink-muted">
            Customer (Ledger Name) <span className="text-[#B91C1C]">*</span>
          </span>
          <Select
            ariaLabel="Customer"
            options={options.customers}
            value={order.customerId}
            onValueChange={(id) => void chooseCustomer(id)}
            disabled={disabled}
            searchable
            placeholder="Choose the customer from the Customer Master…"
            searchPlaceholder="Search the Customer Master…"
            className={`h-9 text-[13px] ${need("", order.customerId) ? bad : ""}`}
          />
          {filledFrom && <p className="text-[12px] text-ink-subtle">Buyer details filled from the Customer Master record of {filledFrom}.</p>}
        </div>
        <Grid cols={4}>
          <Label field="buyerBillTo">{voucherBox("buyerBillTo")}</Label>
          <Label field="buyerMailingName">{voucherBox("buyerMailingName")}</Label>
          <Label field="buyerAddressType">{voucherBox("buyerAddressType")}</Label>
          <Label field="buyerRegType">
            <Choice field={soField("buyerRegType")} value={v.buyerRegType ?? ""} onChange={(x) => setVoucher("buyerRegType", x)} invalid={need("", v.buyerRegType)} disabled={disabled} />
          </Label>
          <Label field="buyerAddress" wide>
            {voucherBox("buyerAddress")}
          </Label>
          <Label field="buyerCountry">{voucherBox("buyerCountry")}</Label>
          <Label field="buyerState">
            <StateBox ariaLabel={tallyName("buyerState")} country={v.buyerCountry ?? ""} value={v.buyerState ?? ""} onChange={(x) => setVoucher("buyerState", x)} invalid={need("", v.buyerState)} disabled={disabled} />
          </Label>
          <Label field="buyerPincode">{voucherBox("buyerPincode")}</Label>
          <Label field="gstin" required={registered}>
            <TextBox ariaLabel={tallyName("gstin")} value={v.gstin ?? ""} onChange={(x) => setVoucher("gstin", x.toUpperCase())} invalid={need("", v.gstin, registered)} placeholder={registered ? "" : "Not needed for this registration type"} disabled={disabled} />
          </Label>
          <Label field="placeOfSupply">
            <StateBox ariaLabel={tallyName("placeOfSupply")} country={v.buyerCountry ?? ""} value={v.placeOfSupply ?? ""} onChange={(x) => setVoucher("placeOfSupply", x)} invalid={need("", v.placeOfSupply)} disabled={disabled} />
          </Label>
          <Label field="buyerBillOfEntry" required={ruleNow("buyerBillOfEntry", (k) => v[k])}>
            <YesNo ariaLabel={tallyName("buyerBillOfEntry")} value={v.buyerBillOfEntry ?? ""} onChange={(x) => setVoucher("buyerBillOfEntry", x)} invalid={need("", v.buyerBillOfEntry, ruleNow("buyerBillOfEntry", (k) => v[k]))} disabled={disabled} />
          </Label>
          <Label field="buyerSec7">
            <YesNo ariaLabel={tallyName("buyerSec7")} value={v.buyerSec7 ?? ""} onChange={(x) => setVoucher("buyerSec7", x)} invalid={need("", v.buyerSec7)} disabled={disabled} />
          </Label>
        </Grid>
        <TallyExtras scope="voucher" section="Party Details (Buyer/Supplier)" title="More buyer details" values={v} valueOf={(k) => v[k]} onChange={setVoucher} owner="the buyer" tried={tried} disabled={disabled} />
      </Section>

      <Section letter="C" title="Consignee (ship to)" hint="Party Details (Consignee). The buyer's details are used unless the goods go somewhere else.">
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-strong">
          <input type="checkbox" checked={order.separateConsignee} disabled={disabled} onChange={(e) => setOrder((o) => ({ ...o, separateConsignee: e.target.checked }))} />
          Ship to a different consignee
        </label>
        {order.separateConsignee ? (
          <div className="mt-3">
            <Grid cols={4}>
              {consigneeKeys.map((key) =>
                key === "consigneeState" ? (
                  <Label key={key} field={key}>
                    <StateBox ariaLabel={`Consignee ${tallyName(key)}`} country={v.consigneeCountry ?? ""} value={v.consigneeState ?? ""} onChange={(x) => setVoucher("consigneeState", x)} invalid={need("", v.consigneeState)} disabled={disabled} />
                  </Label>
                ) : (
                  <Label key={key} field={key} wide={key === "consigneeAddress"}>
                    <TextBox ariaLabel={tallyName(key)} value={v[key] ?? ""} onChange={(x) => setVoucher(key, key === "consigneeGstin" ? x.toUpperCase() : x)} invalid={need("", v[key], !soField(key).notEnforced)} disabled={disabled} />
                  </Label>
                ),
              )}
            </Grid>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-ink-muted">Consignee = buyer{v.buyerBillTo ? ` (${v.buyerBillTo}${v.buyerState ? `, ${v.buyerState}` : ""})` : ""}.</p>
        )}
      </Section>

      <Section letter="D" title="Ledgers" hint="Ledger Details. The customer's amount is the order total and the sales ledger's is the items' total, both worked out.">
        <h4 className="text-[12.5px] font-bold text-ink-strong">
          Customer ledger <span className="font-normal text-ink-muted">· {order.customerName || "choose the customer in B"} · Dr {money(totals.totalPaise)}</span>
        </h4>
        <div className="mt-2">
          <Grid>{entryFields(order.party, (p) => setOrder((o) => ({ ...o, party: { ...o.party, ...p } })), "the customer ledger")}</Grid>
          {costCentres(order.party.costCentres, (next) => setOrder((o) => ({ ...o, party: { ...o.party, costCentres: next } })), "the customer ledger")}
        </div>
        <h4 className="mt-4 text-[12.5px] font-bold text-ink-strong">
          Sales ledger <span className="font-normal text-ink-muted">· the product lines sit under it · Cr {money(totals.itemsPaise)}</span>
        </h4>
        <div className="mt-2">
          <Grid cols={4}>
            <Label field="partyName" required>
              <TextBox ariaLabel="Sales ledger name" list={ledgerListId} value={order.sales.name} onChange={(x) => setOrder((o) => ({ ...o, sales: { ...o.sales, name: x } }))} invalid={need("", order.sales.name)} placeholder="e.g. the sales ledger's name in Tally" disabled={disabled} />
            </Label>
            {entryFields(order.sales, (p) => setOrder((o) => ({ ...o, sales: { ...o.sales, ...p } })), "the sales ledger")}
          </Grid>
          {costCentres(order.sales.costCentres, (next) => setOrder((o) => ({ ...o, sales: { ...o.sales, costCentres: next } })), "the sales ledger")}
        </div>
        <h4 className="mt-4 text-[12.5px] font-bold text-ink-strong">Other ledgers <span className="font-normal text-ink-muted">· tax, freight, discount, round-off</span></h4>
        {order.ledgers.map((l, i) => (
          <div key={i} className="mt-2 rounded-lg p-3" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-bold text-ink-strong">Ledger {i + 1}</span>
              <button type="button" aria-label={`Remove ledger ${i + 1}`} disabled={disabled} onClick={() => setOrder((o) => ({ ...o, ledgers: o.ledgers.filter((_, j) => j !== i) }))} className="grid h-7 w-7 place-items-center rounded-md text-ink-subtle hover:bg-white hover:text-[#B91C1C]">
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
            <div className="mt-1.5">
              <Grid cols={4}>
                <Label field="partyName">
                  <TextBox ariaLabel={`Ledger ${i + 1} name`} list={ledgerListId} value={l.name} onChange={(x) => setLedger(i, { name: x })} invalid={need("", l.name)} disabled={disabled} />
                </Label>
                <Label field="amount">
                  <TextBox ariaLabel={`Ledger ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={(x) => setLedger(i, { amount: x })} invalid={need("", l.amount)} disabled={disabled} />
                </Label>
                <Label field="drCr">
                  <select aria-label={`Ledger ${i + 1} Dr/Cr`} className={`${FIELD} ${ok}`} value={l.drCr} disabled={disabled} onChange={(e) => setLedger(i, { drCr: e.target.value as "Dr" | "Cr" })}>
                    <option value="Cr">Cr — adds to the total</option>
                    <option value="Dr">Dr — takes away from it</option>
                  </select>
                </Label>
                {entryFields(l, (p) => setLedger(i, p), `ledger ${i + 1}`)}
              </Grid>
              {costCentres(l.costCentres, (next) => setLedger(i, { costCentres: next }), `ledger ${i + 1}`)}
            </div>
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => setOrder((o) => ({ ...o, ledgers: [...o.ledgers, emptyLedger()] }))} className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: BLUE }}>
          <Plus size={15} aria-hidden /> Add ledger
        </button>
      </Section>

      <Section letter="E" title="Items" hint="Item Details, Item Allocations (F) and GST / HSN/SAC (G) for each product.">
        {order.items.map((item, i) => {
          const amount = itemAmountPaise(item.values);
          const iv = item.values;
          const single = item.allocations.length === 1;
          const gst = iv.gstRateDetails ?? "";
          const hsn = iv.hsnDetails ?? "";
          const lineValue = (k: string) => iv[k] ?? v[k];
          const itemBox = (key: string, required?: boolean, inputMode?: "decimal") => (
            <TextBox ariaLabel={`Item ${i + 1} ${tallyName(key)}`} inputMode={inputMode} value={iv[key] ?? ""} onChange={(x) => setItemValue(i, key, x)} invalid={need("", iv[key], required ?? requiredByConfig(catalogue, key))} disabled={disabled} />
          );
          return (
            <div key={i} className="mb-3 rounded-xl p-3" style={{ border: "1px solid var(--color-hairline-strong)" }}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13.5px] font-bold text-ink-strong">
                  Item {i + 1} <span className="font-normal text-ink-muted">· {amount === null ? "amount when quantity and rate are filled" : `Item Amount ${money(amount)}`}</span>
                </h4>
                {order.items.length > 1 && (
                  <button type="button" aria-label={`Remove item ${i + 1}`} disabled={disabled} onClick={() => setOrder((o) => ({ ...o, items: o.items.filter((_, j) => j !== i) }))} className="grid h-7 w-7 place-items-center rounded-md text-ink-subtle hover:bg-[#F6F8FB] hover:text-[#B91C1C]">
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1">
                <span className="text-[12px] font-semibold text-ink-muted">
                  {tallyName("itemName")} <span className="text-[#B91C1C]">*</span>
                </span>
                <Select
                  ariaLabel={`Item ${i + 1} product`}
                  options={options.products}
                  value={item.productRef}
                  onValueChange={(ref) => chooseProduct(i, ref)}
                  disabled={disabled}
                  searchable
                  placeholder="Choose the item from the Product Master…"
                  searchPlaceholder="Search the Product Master…"
                  className={`h-9 text-[13px] ${need("", item.productRef) ? bad : ""}`}
                />
              </div>
              <div className="mt-2.5">
                <Grid cols={4}>
                  <Label field="itemDescription" wide>
                    {itemBox("itemDescription")}
                  </Label>
                  <Label field="quantity">{itemBox("quantity", true, "decimal")}</Label>
                  <Label field="rate">{itemBox("rate", true, "decimal")}</Label>
                  <Label field="ratePer">{itemBox("ratePer")}</Label>
                  <Label field="lineAmount">
                    <TextBox ariaLabel={`Item ${i + 1} ${tallyName("lineAmount")}`} value={amount === null ? "" : (amount / 100).toFixed(2)} onChange={() => undefined} disabled placeholder="Worked out" />
                  </Label>
                </Grid>
                <More label="Discount and MRP — Disc%, Discount Amount, MRP/Marginal (optional)">
                  <Grid>
                    <Label field="discPct">{itemBox("discPct", false, "decimal")}</Label>
                    <Label field="discAmount">{itemBox("discAmount", false, "decimal")}</Label>
                    <Label field="mrp">{itemBox("mrp", false, "decimal")}</Label>
                  </Grid>
                </More>
                <TallyExtras scope="item" section="Item Details" title="More item details" values={iv} valueOf={lineValue} onChange={(k, x) => setItemValue(i, k, x)} owner={`item ${i + 1}`} tried={tried} disabled={disabled} />
              </div>

              {formFields(catalogue, "item").some((f) => f.isCustom) && (
                <div className="mt-3">
                  <Grid>
                    <CustomFields scope="item" values={iv} onChange={(k, x) => setItemValue(i, k, x)} owner={`item ${i + 1}`} tried={tried} disabled={disabled} />
                  </Grid>
                </div>
              )}
              <div className="mt-3 rounded-lg p-3" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
                <p className="text-[12.5px] font-bold text-ink-strong">
                  F · Item allocations <span className="font-normal text-ink-muted">· {single ? "one delivery: quantity, rate and amount are the line's unless you change them" : "split deliveries: the allocations must add up to the line"}</span>
                </p>
                {item.allocations.map((a, j) => {
                  const worked = single ? null : allocationAmountPaise(a);
                  const allocBox = (key: string, inputMode?: "decimal") => (
                    <TextBox
                      ariaLabel={`Item ${i + 1} allocation ${j + 1} ${tallyName(key)}`}
                      inputMode={inputMode}
                      value={a[key] ?? ""}
                      onChange={(x) => setAlloc(i, j, key, x)}
                      invalid={need("", a[key], !single && ["allocQuantity", "allocRate", "allocRatePer"].includes(key)) || (key === "allocAmount" && !single && tried && blank(a[key]) && worked === null)}
                      placeholder={single ? "Same as the line" : key === "allocAmount" && worked !== null ? `Worked out: ${(worked / 100).toFixed(2)}` : ""}
                      disabled={disabled}
                    />
                  );
                  return (
                    <div key={j} className="mt-2">
                      <div className="grid grid-cols-[150px_1fr_1fr_1fr_1fr_auto] max-lg:grid-cols-3 max-sm:grid-cols-1 items-end gap-2">
                        <Label field="dueDate">
                          <DateField aria-label={`Item ${i + 1} allocation ${j + 1} ${tallyName("dueDate")}`} className={`${FIELD} ${need("", a.dueDate) ? bad : ok} tabular-nums`} value={a.dueDate ?? ""} onChange={(x) => setAlloc(i, j, "dueDate", x)} disabled={disabled} />
                        </Label>
                        <Label field="allocQuantity" required={!single}>
                          {allocBox("allocQuantity", "decimal")}
                        </Label>
                        <Label field="allocRate" required={!single}>
                          {allocBox("allocRate", "decimal")}
                        </Label>
                        <Label field="allocRatePer" required={!single}>
                          {allocBox("allocRatePer")}
                        </Label>
                        <Label field="allocAmount" required={!single}>
                          {allocBox("allocAmount", "decimal")}
                        </Label>
                        {item.allocations.length > 1 ? (
                          <button type="button" aria-label={`Remove allocation ${j + 1} of item ${i + 1}`} disabled={disabled} onClick={() => setItem(i, (it) => ({ ...it, allocations: it.allocations.filter((_, k) => k !== j) }))} className="mb-1 grid h-8 w-8 place-items-center rounded-md text-ink-subtle hover:bg-white hover:text-[#B91C1C]">
                            <Trash2 size={15} aria-hidden />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                      {formFields(catalogue, "allocation").some((f) => f.isCustom) && (
                        <div className="mt-2">
                          <Grid>
                            <CustomFields scope="allocation" values={a} onChange={(k, x) => setAlloc(i, j, k, x)} owner={`item ${i + 1} allocation ${j + 1}`} tried={tried} disabled={disabled} />
                          </Grid>
                        </div>
                      )}
                      <More label={`Allocation ${j + 1} — Tracking No. (?), Order No. (?), Cost Tracking To (?), discounts (optional)`}>
                        <Grid cols={4}>
                          <Label field="allocTrackingNo">{allocBox("allocTrackingNo")}</Label>
                          <Label field="allocOrderNo">{allocBox("allocOrderNo")}</Label>
                          <Label field="allocCostTracking">{allocBox("allocCostTracking")}</Label>
                          <Label field="allocDiscPct">{allocBox("allocDiscPct", "decimal")}</Label>
                          <Label field="allocDiscAmount">{allocBox("allocDiscAmount", "decimal")}</Label>
                        </Grid>
                      </More>
                      <TallyExtras scope="allocation" section="Item Allocations Details" title={`More for allocation ${j + 1}`} values={a} valueOf={(k) => a[k] ?? lineValue(k)} onChange={(k, x) => setAlloc(i, j, k, x)} owner={`item ${i + 1} allocation ${j + 1}`} tried={tried} disabled={disabled} />
                      {single && singleDeliveryDiscountNote(item) && (
                        <p role="note" className="mt-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-ink-muted" style={{ background: "var(--color-amber-bg)" }}>
                          {singleDeliveryDiscountNote(item)}
                        </p>
                      )}
                    </div>
                  );
                })}
                <button type="button" disabled={disabled} onClick={() => setItem(i, (it) => ({ ...it, allocations: [...it.allocations, {}] }))} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: BLUE }}>
                  <Plus size={14} aria-hidden /> Split into another delivery
                </button>
              </div>

              <div className="mt-3 rounded-lg p-3" style={{ border: "1px solid var(--color-hairline)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-bold text-ink-strong">G · GST and HSN/SAC</p>
                  {order.items.length > 1 && (
                    <button type="button" disabled={disabled} onClick={() => copyTaxToAll(i)} className="inline-flex items-center gap-1 text-[12px] font-bold" style={{ color: BLUE }}>
                      <Copy size={13} aria-hidden /> Use for every item
                    </button>
                  )}
                </div>
                <div className="mt-2">
                  <Grid cols={4}>
                    <Label field="gstRateDetails">
                      <Choice field={soField("gstRateDetails")} ariaLabel={`Item ${i + 1} ${tallyName("gstRateDetails")}`} value={gst} onChange={(x) => setItemValue(i, "gstRateDetails", x)} invalid={need("", gst)} disabled={disabled} />
                    </Label>
                    <Label field="reverseCharge">
                      <YesNo ariaLabel={`Item ${i + 1} ${tallyName("reverseCharge")}`} value={iv.reverseCharge ?? ""} onChange={(x) => setItemValue(i, "reverseCharge", x)} invalid={need("", iv.reverseCharge)} disabled={disabled} />
                    </Label>
                    <Label field="itcEligible">
                      <YesNo ariaLabel={`Item ${i + 1} ${tallyName("itcEligible")}`} value={iv.itcEligible ?? ""} onChange={(x) => setItemValue(i, "itcEligible", x)} invalid={need("", iv.itcEligible)} disabled={disabled} />
                    </Label>
                    <Label field="taxableValue">{itemBox("taxableValue", true, "decimal")}</Label>
                    {gst === "Specify Details Here" && (
                      <>
                        <Label field="igstRate" required>
                          {itemBox("igstRate", true, "decimal")}
                        </Label>
                        <Label field="cgstRate" required>
                          {itemBox("cgstRate", true, "decimal")}
                        </Label>
                        <Label field="sgstRate" required>
                          {itemBox("sgstRate", true, "decimal")}
                        </Label>
                        <Label field="gstTaxability" required={ruleNow("gstTaxability", lineValue)}>
                          <Choice field={soField("gstTaxability")} ariaLabel={`Item ${i + 1} ${tallyName("gstTaxability")}`} value={iv.gstTaxability ?? ""} onChange={(x) => setItemValue(i, "gstTaxability", x)} invalid={need("", iv.gstTaxability, ruleNow("gstTaxability", lineValue))} disabled={disabled} />
                        </Label>
                        <Label field="gstNature" wide>
                          <Choice field={soField("gstNature")} ariaLabel={`Item ${i + 1} ${tallyName("gstNature")}`} value={iv.gstNature ?? ""} onChange={(x) => setItemValue(i, "gstNature", x)} disabled={disabled} />
                        </Label>
                      </>
                    )}
                    {gst === "Use GST Classification" && (
                      <Label field="gstClassification" required={ruleNow("gstClassification", lineValue)} wide>
                        {itemBox("gstClassification", ruleNow("gstClassification", lineValue))}
                      </Label>
                    )}
                    {gst === "As per Masters/Company" && (
                      <>
                        <Label field="gstSource">{itemBox("gstSource", false)}</Label>
                        <Label field="gstSourceType">
                          <Choice field={soField("gstSourceType")} ariaLabel={`Item ${i + 1} ${tallyName("gstSourceType")}`} value={iv.gstSourceType ?? ""} onChange={(x) => setItemValue(i, "gstSourceType", x)} disabled={disabled} />
                        </Label>
                      </>
                    )}
                  </Grid>
                  <TallyExtras scope="item" section="GST Rate & Related Details" title="More GST details" values={iv} valueOf={lineValue} onChange={(k, x) => setItemValue(i, k, x)} owner={`item ${i + 1}`} tried={tried} disabled={disabled} />
                  <div className="mt-2.5">
                    <Grid cols={4}>
                      <Label field="hsnDetails">
                        <Choice field={soField("hsnDetails")} ariaLabel={`Item ${i + 1} ${tallyName("hsnDetails")}`} value={hsn} onChange={(x) => setItemValue(i, "hsnDetails", x)} invalid={need("", hsn)} disabled={disabled} />
                      </Label>
                      {hsn === "Specify Details Here" && (
                        <>
                          <Label field="hsn" required>
                            {itemBox("hsn", true)}
                          </Label>
                          <Label field="hsnDescription" required={ruleNow("hsnDescription", lineValue)} wide>
                            {itemBox("hsnDescription", ruleNow("hsnDescription", lineValue))}
                          </Label>
                        </>
                      )}
                      {hsn === "As per Masters/Company" && (
                        <>
                          <Label field="hsnSource">{itemBox("hsnSource", false)}</Label>
                          <Label field="hsnSourceType">
                            <Choice field={soField("hsnSourceType")} ariaLabel={`Item ${i + 1} ${tallyName("hsnSourceType")}`} value={iv.hsnSourceType ?? ""} onChange={(x) => setItemValue(i, "hsnSourceType", x)} disabled={disabled} />
                          </Label>
                        </>
                      )}
                      {hsn === "Use GST Classification" && <Label field="hsnClassification">{itemBox("hsnClassification", false)}</Label>}
                    </Grid>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" disabled={disabled} onClick={() => setOrder((o) => ({ ...o, items: [...o.items, emptyItem()] }))} className="inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: BLUE }}>
          <Plus size={15} aria-hidden /> Add item
        </button>
      </Section>

      <Section letter="H" title="Dispatch and delivery" hint="Dispatch/Receipt/Party's Document Details and Export/Import Details">
        <Grid>
          <Label field="dispatchedThrough">{voucherBox("dispatchedThrough")}</Label>
          <Label field="destination">{voucherBox("destination")}</Label>
          <Label field="carrier">{voucherBox("carrier")}</Label>
        </Grid>
        <TallyExtras scope="voucher" section="Export/Import Details" title="Export details" values={v} valueOf={(k) => v[k]} onChange={setVoucher} owner="the order" tried={tried} disabled={disabled} />
      </Section>

      <Section letter="I" title="Additional details" hint="Original Invoice Details and Additional Cost — only when they apply" optional defaultOpen={false}>
        <Grid>
          <Label field="originalSalesNature">
            <Choice field={soField("originalSalesNature")} value={v.originalSalesNature ?? ""} onChange={(x) => setVoucher("originalSalesNature", x)} disabled={disabled} />
          </Label>
        </Grid>
        <h4 className="mt-3 text-[12.5px] font-bold text-ink-strong">Additional cost (?)</h4>
        {order.additionalCosts.map((a, i) => (
          <div key={i} className="mt-2 grid grid-cols-[1fr_140px_160px_auto] max-sm:grid-cols-1 items-end gap-2">
            <Label field="addlCostLedger" required>
              <TextBox ariaLabel={`Additional cost ${i + 1} ledger`} list={ledgerListId} value={a.ledger} onChange={(x) => setOrder((o) => ({ ...o, additionalCosts: o.additionalCosts.map((y, j) => (j === i ? { ...y, ledger: x } : y)) }))} invalid={need("", a.ledger)} disabled={disabled} />
            </Label>
            <Label field="addlCostPct">
              <TextBox ariaLabel={`Additional cost ${i + 1} percentage`} inputMode="decimal" value={a.percent} onChange={(x) => setOrder((o) => ({ ...o, additionalCosts: o.additionalCosts.map((y, j) => (j === i ? { ...y, percent: x } : y)) }))} disabled={disabled} />
            </Label>
            <Label field="addlCostAmount">
              <TextBox ariaLabel={`Additional cost ${i + 1} amount`} inputMode="decimal" value={a.amount} onChange={(x) => setOrder((o) => ({ ...o, additionalCosts: o.additionalCosts.map((y, j) => (j === i ? { ...y, amount: x } : y)) }))} disabled={disabled} />
            </Label>
            <button type="button" aria-label={`Remove additional cost ${i + 1}`} disabled={disabled} onClick={() => setOrder((o) => ({ ...o, additionalCosts: o.additionalCosts.filter((_, j) => j !== i) }))} className="mb-1 grid h-8 w-8 place-items-center rounded-md text-ink-subtle hover:bg-[#F6F8FB] hover:text-[#B91C1C]">
              <Trash2 size={15} aria-hidden />
            </button>
            {formFields(catalogue, "additionalCost").some((f) => f.isCustom) && (
              <div className="col-span-full">
                <Grid>
                  <CustomFields scope="additionalCost" values={a.custom} onChange={(k, x) => setOrder((o) => ({ ...o, additionalCosts: o.additionalCosts.map((y, j) => (j === i ? { ...y, custom: { ...y.custom, [k]: x } } : y)) }))} owner={`additional cost ${i + 1}`} tried={tried} disabled={disabled} />
                </Grid>
              </div>
            )}
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => setOrder((o) => ({ ...o, additionalCosts: [...o.additionalCosts, { ledger: "", percent: "", amount: "" }] }))} className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: BLUE }}>
          <Plus size={15} aria-hidden /> Add additional cost
        </button>
      </Section>

      <Section letter="J" title="Voucher status" hint="Voucher Status">
        <Grid cols={4}>
          {(["isOptional", "isPostDated", "isCancelled"] as const).map((key) => (
            <Label key={key} field={key}>
              <YesNo ariaLabel={tallyName(key)} value={v[key] ?? ""} onChange={(x) => setVoucher(key, x)} invalid={need("", v[key])} disabled={disabled} />
            </Label>
          ))}
          <Label field="changeMode">
            <select aria-label={tallyName("changeMode")} className={`${FIELD} ${need("", v.changeMode) ? bad : ok}`} value={v.changeMode ?? ""} disabled={disabled} onChange={(e) => setVoucher("changeMode", e.target.value)}>
              <option value="">Choose…</option>
              {CHANGE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Label>
        </Grid>
      </Section>

      {formFields(catalogue, "voucher").some((f) => f.isCustom) && (
        <Section letter="K" title="Custom fields" hint="Fields added in Admin & Master Setup → Sales Order Fields">
          <Grid>
            <CustomFields scope="voucher" values={v} onChange={setVoucher} owner="the order" tried={tried} disabled={disabled} />
          </Grid>
        </Section>
      )}

      {/* The totals and Check order: in the page's flow, after the last section (they scroll with the form). */}
      <div className="rounded-section bg-white px-4 py-3" style={CARD}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <div>
              <dt className="inline text-ink-muted">Items </dt>
              <dd className="inline font-bold tabular-nums text-ink-strong">{money(totals.itemsPaise)}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Other ledgers </dt>
              <dd className="inline font-bold tabular-nums text-ink-strong">{money(totals.othersPaise)}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Order total </dt>
              <dd className="inline font-extrabold tabular-nums" style={{ color: BLUE }}>
                {money(totals.totalPaise)}
              </dd>
            </div>
          </dl>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-ink-subtle">Checking writes nothing.</span>
            <button type="button" disabled={disabled || busy} onClick={check} className="inline-flex items-center gap-1.5 rounded-pill px-5 py-2.5 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "linear-gradient(135deg, #0A6CFF 0%, #0B4FB8 100%)" }}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Check order
            </button>
          </div>
        </div>
        {problems.length > 0 && (
          <ul role="alert" aria-label="What to fix" className="mt-2 max-h-[220px] list-disc overflow-y-auto pl-5 text-[12.5px] text-[#B91C1C]">
            {problems.map((p, k) => (
              <li key={k}>
                <span className="font-bold">{p.where}:</span> {p.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
