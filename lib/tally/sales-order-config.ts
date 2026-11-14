import { SO_FIELDS, SO_SECTIONS, isEnforced, type SoField, type SoFieldType } from "./sales-order-catalogue";

/**
 * The EFFECTIVE Sales Order field configuration: TallyPrime's Sales Order
 * matrix (./sales-order-catalogue — the base, in code) with the settings
 * authorised administrators keep in Admin & Master Setup → Sales Order Fields
 * (table sales_order_field_settings, migration 0128) laid over it, plus their
 * custom fields. Pure: the server builds it from the stored settings and hands
 * the same thing to the form, the template, the column mapping, the planner,
 * the comparison and the order page — none of them carries a field rule of its
 * own.
 *
 * What a setting can change, field by field:
 *   label, section, display order        — any field (a locked field: label and order only)
 *   mandatory / optional / conditional   — any field but a locked one
 *   the condition                        — from a fixed vocabulary (Condition below); never executable text
 *   form / import / order page           — any field but a locked one
 *   allowed values                       — a subset of a matrix field's own values; a custom field's list
 *   active / retired                     — any field but a locked one; retiring never deletes stored values
 * A field with no setting keeps the matrix's rule. A matrix field's own
 * behaviours — the consignee defaulting to the buyer, a single allocation
 * defaulting to its line, Tally's applicable-value conditions — are part of
 * the base and stay unless a setting replaces the requirement.
 */

/** Where a field lives in an order. Buyer, consignee, order details, dispatch and voucher states are the order (voucher) itself; cost-centre allocations belong to a ledger entry. */
export type FieldScope = "voucher" | "ledger" | "item" | "allocation" | "additionalCost";
export const FIELD_SCOPES: readonly FieldScope[] = ["voucher", "ledger", "item", "allocation", "additionalCost"];
export const SCOPE_LABEL: Record<FieldScope, string> = { voucher: "Order", ledger: "Ledger entry", item: "Product line", allocation: "Item allocation", additionalCost: "Additional cost" };
export const scopeOfLevel = (level: SoField["level"]): FieldScope =>
  level === "buyer" || level === "consignee" || level === "voucher" ? "voucher" : level === "costCentre" ? "ledger" : (level as FieldScope);

/** They decide an order's identity and its totals: labels and display order only. Their approved conditions stay as they are. */
export const LOCKED_FIELD_KEYS: ReadonlySet<string> = new Set(["documentNo", "documentDate", "voucherType", "partyName", "amount", "itemName", "quantity", "rate", "lineAmount", "preCloseQuantity", "preCloseDate"]);

/** The condition vocabulary. Each one is evaluated by code here; nothing a setting holds is ever run. */
export type Condition =
  | { op: "in" | "notIn"; field: string; values: string[] }
  | { op: "given"; field: string }
  /** Ledger-entry fields: the customer's own entry, the other entries, or both. */
  | { op: "ledgerKind"; values: ("customer" | "other")[] };

/** always = required; never = optional; when = required while the condition holds. */
export type RequirementRule = { kind: "always" } | { kind: "never" } | { kind: "when"; condition: Condition };

export type FieldStatus = "active" | "retired";
export const CUSTOM_TYPES: readonly SoFieldType[] = ["text", "date", "amount", "number", "percent", "yesno", "choice"];

/** One stored setting (a row of sales_order_field_settings). */
export interface FieldSetting {
  fieldKey: string;
  isCustom: boolean;
  scope: FieldScope;
  label: string | null;
  section: string | null;
  displayOrder: number | null;
  requirement: "mandatory" | "optional" | "conditional" | null;
  condition: Condition | null;
  fieldType: SoFieldType | null;
  options: string[] | null;
  inForm: boolean;
  inImport: boolean;
  onOrderPage: boolean;
  status: FieldStatus;
  rowVersion: number;
}

/** A field as everything downstream sees it. */
export interface ConfiguredField extends SoField {
  scope: FieldScope;
  isCustom: boolean;
  locked: boolean;
  status: FieldStatus;
  inForm: boolean;
  inImport: boolean;
  onOrderPage: boolean;
  displayOrder: number;
  /** The effective requirement: the setting's, else the matrix's own. (`rule` is the validation rule in words.) */
  requirementRule: RequirementRule;
  /** The setting row, when there is one (its row_version is what a save must name). */
  setting: FieldSetting | null;
}

export interface SoCatalogue {
  /** The configuration version (sales_order_field_history); 0 = no setting has ever been saved. */
  version: number;
  /** Every field, active and retired, in section then display order. */
  fields: ConfiguredField[];
  sections: string[];
  byKey: Map<string, ConfiguredField>;
}

/** The matrix's own requirement for a base field. */
export function baseRule(f: SoField): RequirementRule {
  if (f.notEnforced) return { kind: "never" };
  // A Y field that applies only in some cases, or a ? field the business requires in one case (GST Classification
  // under "Use GST Classification"): required while its condition holds.
  if (f.mandatoryWhen) return { kind: "when", condition: { op: "in", field: f.mandatoryWhen.field, values: [...f.mandatoryWhen.values] } };
  return isEnforced(f) ? { kind: "always" } : { kind: "never" };
}

const ruleOf = (s: FieldSetting | null, base: RequirementRule): RequirementRule =>
  !s?.requirement ? base : s.requirement === "mandatory" ? { kind: "always" } : s.requirement === "optional" ? { kind: "never" } : s.condition ? { kind: "when", condition: s.condition } : base;

/** The effective configuration from the stored settings. Settings for unknown non-custom keys are ignored. */
export function buildCatalogue(settings: readonly FieldSetting[], version = 0): SoCatalogue {
  const byKeySetting = new Map(settings.map((s) => [s.fieldKey, s]));
  const fields: ConfiguredField[] = SO_FIELDS.map((f) => {
    const s = byKeySetting.get(f.key) ?? null;
    const locked = LOCKED_FIELD_KEYS.has(f.key);
    const allowed = s?.options?.length && f.options ? f.options.filter((o) => s.options!.includes(o)) : f.options;
    return {
      ...f,
      label: s?.label ?? f.label,
      // A matrix field's heading in a file stays its Tally name, whatever its label on screen.
      tallyName: f.tallyName,
      section: (locked ? f.section : (s?.section ?? f.section)) as SoField["section"],
      options: allowed,
      scope: scopeOfLevel(f.level),
      isCustom: false,
      locked,
      status: locked ? "active" : (s?.status ?? "active"),
      inForm: locked ? true : (s?.inForm ?? true),
      // A pre-close field is entered on the order's page, never imported with a new order.
      inImport: f.workflow ? false : locked ? true : (s?.inImport ?? true),
      onOrderPage: locked ? true : (s?.onOrderPage ?? true),
      displayOrder: s?.displayOrder ?? f.matrixRow * 10,
      requirementRule: locked ? baseRule(f) : ruleOf(s, baseRule(f)),
      setting: s,
    };
  });
  for (const s of settings) {
    if (!s.isCustom || !s.fieldType || !s.label || !s.section) continue;
    const custom: ConfiguredField = {
      key: s.fieldKey,
      // A custom field's label is also its column heading in an import file.
      tallyName: s.label,
      label: s.label,
      section: s.section as SoField["section"],
      requirement: s.requirement === "mandatory" ? "mandatory" : s.requirement === "conditional" ? "conditional" : "provision",
      level: s.scope,
      type: s.fieldType,
      options: s.fieldType === "choice" ? (s.options ?? []) : s.fieldType === "yesno" ? ["Yes", "No"] : undefined,
      rule: `Custom field (${SCOPE_LABEL[s.scope]}).`,
      matrixRow: 0,
      scope: s.scope,
      isCustom: true,
      locked: false,
      status: s.status,
      inForm: s.inForm,
      inImport: s.inImport,
      onOrderPage: s.onOrderPage,
      displayOrder: s.displayOrder ?? 1_000_000,
      requirementRule: ruleOf(s, { kind: "never" }),
      setting: s,
    };
    fields.push(custom);
  }
  const sections = [...SO_SECTIONS] as string[];
  for (const f of fields) if (!sections.includes(f.section)) sections.push(f.section);
  fields.sort((a, b) => sections.indexOf(a.section) - sections.indexOf(b.section) || a.displayOrder - b.displayOrder || a.key.localeCompare(b.key));
  return { version, fields, sections, byKey: new Map(fields.map((f) => [f.key, f])) };
}

/** The matrix alone: what every screen uses when no setting exists (or migration 0128 isn't applied). */
export const BASE_CATALOGUE: SoCatalogue = buildCatalogue([]);

// A new order's fields. The pre-close fields (marked "Update") are never part of one: preCloseFields.
export const activeFields = (c: SoCatalogue, scope?: FieldScope) => c.fields.filter((f) => f.status === "active" && !f.workflow && (!scope || f.scope === scope));
export const importFields = (c: SoCatalogue) => c.fields.filter((f) => f.status === "active" && f.inImport && !f.workflow);
export const formFields = (c: SoCatalogue, scope: FieldScope) => c.fields.filter((f) => f.status === "active" && f.inForm && !f.workflow && f.scope === scope);
/** The pre-close workflow's fields as configured (labels, the reason's requirement), in display order. */
export const preCloseFields = (c: SoCatalogue) => c.fields.filter((f) => f.workflow === "preClose");
/** Stored by key in its scope's `custom` map: a custom field, or a matrix field with no fixed place (`keyed`). */
export const isKeyed = (f: Pick<SoField, "keyed"> & { isCustom?: boolean }) => !!f.isCustom || !!f.keyed;

/** Whether a field is required, given a way to read other fields' values (its own scope first, then the order) and, for a ledger entry, whose it is. */
export function isRequired(f: ConfiguredField, valueOf: (key: string) => string | null, ledgerKind?: "customer" | "other"): boolean {
  if (f.status !== "active") return false;
  const r = f.requirementRule;
  if (r.kind === "always") return true;
  if (r.kind === "never") return false;
  return conditionHolds(r.condition, valueOf, ledgerKind);
}

export function conditionHolds(c: Condition, valueOf: (key: string) => string | null, ledgerKind?: "customer" | "other"): boolean {
  if (c.op === "ledgerKind") return !!ledgerKind && c.values.includes(ledgerKind);
  const v = (valueOf(c.field) ?? "").trim();
  if (c.op === "given") return v !== "";
  const hit = c.values.some((x) => x.toLowerCase() === v.toLowerCase());
  return c.op === "in" ? v !== "" && hit : v !== "" && !hit;
}

/** The condition in words, for the screens. */
export function describeRule(r: RequirementRule, c: SoCatalogue): string {
  if (r.kind === "always") return "Mandatory";
  if (r.kind === "never") return "Optional";
  const k = r.condition;
  if (k.op === "ledgerKind") return `Mandatory on ${k.values.length === 2 ? "every ledger entry" : k.values[0] === "customer" ? "the customer's ledger entry" : "ledger entries other than the customer's"}`;
  const name = c.byKey.get(k.field)?.label ?? k.field;
  if (k.op === "given") return `Mandatory when ${name} is given`;
  return `Mandatory when ${name} is ${k.op === "notIn" ? "not " : ""}${k.values.map((v) => `“${v}”`).join(" or ")}`;
}

/* ── validating a setting before it is saved ─────────────────────────────── */

export interface SettingInput {
  fieldKey: string | null;
  isCustom: boolean;
  scope: FieldScope;
  label: string | null;
  section: string | null;
  displayOrder: number | null;
  requirement: "mandatory" | "optional" | "conditional" | null;
  condition: Condition | null;
  fieldType: SoFieldType | null;
  options: string[] | null;
  inForm: boolean;
  inImport: boolean;
  onOrderPage: boolean;
  status: FieldStatus;
}

/** A custom field's key from its label: "custom_" + a slug, made unique against the catalogue. */
export function customKey(label: string, c: SoCatalogue): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  let key = `custom_${slug}`;
  for (let n = 2; c.byKey.has(key); n++) key = `custom_${slug}_${n}`;
  return key;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Every reason a setting can't be saved; empty = it can. The server checks this on every save. */
export function validateSetting(input: SettingInput, c: SoCatalogue): string[] {
  const errors: string[] = [];
  const base = input.fieldKey && !input.isCustom ? SO_FIELDS.find((f) => f.key === input.fieldKey) : undefined;
  const current = input.fieldKey ? c.byKey.get(input.fieldKey) : undefined;
  if (!input.isCustom && !base) return ["That field isn't in the Sales Order matrix."];
  if (input.isCustom && input.fieldKey && current && !current.isCustom) return ["A matrix field can't become a custom field."];
  if (base?.workflow) {
    // A pre-close field is part of that workflow: its label and order may change, and the reason may be made optional.
    const errors: string[] = [];
    if (input.label !== null && !input.label.trim()) errors.push("The label can't be blank.");
    if (input.label && input.label.trim().length > 120) errors.push("The label is longer than 120 characters.");
    if (input.displayOrder !== null && (!Number.isInteger(input.displayOrder) || input.displayOrder < 0 || input.displayOrder > 100000)) errors.push("The display order must be a whole number from 0 to 100000.");
    if (input.scope !== scopeOfLevel(base.level)) errors.push("A matrix field's scope can't be changed.");
    if (input.section !== null && input.section !== base.section) errors.push(`${base.tallyName} belongs to the pre-close workflow: its section can't change.`);
    if (input.requirement === "conditional" || input.condition !== null) errors.push(`${base.tallyName} is mandatory or optional, never conditional.`);
    if (input.requirement !== null && LOCKED_FIELD_KEYS.has(base.key)) errors.push(`${base.tallyName} is locked: its requirement stays as the matrix sets it.`);
    if (!input.inForm || input.status !== "active") errors.push(`${base.tallyName} belongs to the pre-close workflow: it can't be hidden or retired.`);
    if (input.options !== null || input.fieldType !== null) errors.push(`${base.tallyName}'s type and values come from Tally.`);
    return errors;
  }
  if (base && scopeOfLevel(base.level) !== input.scope) errors.push("A matrix field's scope can't be changed.");
  if (input.label !== null && !input.label.trim()) errors.push("The label can't be blank.");
  if (input.label && input.label.trim().length > 120) errors.push("The label is longer than 120 characters.");
  if (input.section !== null && !input.section.trim()) errors.push("The section can't be blank.");
  if (input.displayOrder !== null && (!Number.isInteger(input.displayOrder) || input.displayOrder < 0 || input.displayOrder > 100000)) errors.push("The display order must be a whole number from 0 to 100000.");

  if (base && LOCKED_FIELD_KEYS.has(base.key)) {
    if (input.section !== null && input.section !== base.section) errors.push(`${base.tallyName} is locked: only its label and display order can change.`);
    if (input.requirement !== null || input.condition !== null) errors.push(`${base.tallyName} is locked: its requirement stays as the matrix sets it.`);
    if (!input.inForm || !input.inImport || !input.onOrderPage || input.status !== "active") errors.push(`${base.tallyName} is locked: it can't be hidden, left out of imports or retired.`);
    if (input.options !== null) errors.push(`${base.tallyName} is locked: its values can't be restricted.`);
  }

  if (input.isCustom) {
    if (!input.label?.trim()) errors.push("A custom field needs a label.");
    if (!input.section?.trim()) errors.push("A custom field needs a section.");
    if (!input.fieldType || !CUSTOM_TYPES.includes(input.fieldType)) errors.push("Choose the custom field's type.");
    if (input.fieldType === "choice" && !(input.options ?? []).filter((o) => o.trim()).length) errors.push("A choice field needs at least one value.");
    // Its label is its column heading in an import file: it can't clash with any other field's heading or label.
    if (input.label?.trim()) {
      const clash = c.fields.find((f) => f.key !== input.fieldKey && (norm(f.tallyName) === norm(input.label!) || norm(f.label) === norm(input.label!)));
      if (clash) errors.push(`“${input.label.trim()}” is already the name of ${clash.isCustom ? "another custom field" : `the field ${clash.tallyName}`}.`);
    }
  } else if (input.fieldType !== null) errors.push("A matrix field's type comes from Tally and can't be changed.");

  if (input.options !== null) {
    const cleaned = input.options.map((o) => o.trim()).filter(Boolean);
    if (new Set(cleaned.map(norm)).size !== cleaned.length) errors.push("The allowed values repeat themselves.");
    if (cleaned.length > 200) errors.push("At most 200 allowed values.");
    if (base) {
      if (!base.options) errors.push(`${base.tallyName} has no list of values to restrict.`);
      else {
        const unknown = cleaned.filter((o) => !base.options!.includes(o));
        if (unknown.length) errors.push(`Not one of ${base.tallyName}'s Tally values: ${unknown.join(", ")}.`);
        if (!cleaned.length) errors.push("Keep at least one allowed value.");
      }
    }
  }

  if (input.requirement === "conditional") {
    const k = input.condition;
    if (!k) errors.push("A conditional field needs its condition.");
    else if (k.op === "ledgerKind") {
      if (input.scope !== "ledger") errors.push("“Customer's / other ledger entries” applies to ledger-entry fields only.");
      if (!k.values.length || k.values.some((v) => v !== "customer" && v !== "other")) errors.push("Choose the customer's entry, the other entries, or both.");
    } else {
      const on = c.byKey.get(k.field);
      if (!on) errors.push("The condition names a field that doesn't exist.");
      else {
        if (on.key === input.fieldKey) errors.push("A field's condition can't depend on itself.");
        if (on.status !== "active") errors.push(`The condition depends on ${on.label}, which is retired.`);
        if (on.scope !== input.scope && on.scope !== "voucher") errors.push(`The condition can depend on a field of the same ${SCOPE_LABEL[input.scope].toLowerCase()} or of the order, not on ${on.label}.`);
        if (k.op !== "given") {
          if (!k.values.length || k.values.some((v) => !v.trim())) errors.push("Give at least one value for the condition.");
          if (on.options && k.values.some((v) => !on.options!.some((o) => o.toLowerCase() === v.toLowerCase()))) errors.push(`The condition's values must be values of ${on.label}: ${on.options.join(", ")}.`);
        }
      }
    }
  } else if (input.condition !== null) errors.push("Only a conditional field has a condition.");

  // A field that can be required must be collectable wherever an order comes from.
  if ((input.requirement === "mandatory" || input.requirement === "conditional" || (input.requirement === null && base && baseRule(base).kind !== "never")) && input.status === "active" && (!input.inForm || !input.inImport)) {
    errors.push("A field that can be mandatory must be available on both the form and the import.");
  }
  if (input.status === "retired" && current) {
    const users = c.fields.filter((f) => {
      const r = f.requirementRule;
      return f.status === "active" && r.kind === "when" && r.condition.op !== "ledgerKind" && r.condition.field === current.key;
    });
    if (users.length) errors.push(`${current.label} can't be retired: ${users.map((u) => u.label).join(", ")} ${users.length === 1 ? "depends" : "depend"} on it.`);
  }
  return errors;
}

/* ── where each field's value is stored in an order ──────────────────────── */

/**
 * The path of a matrix field's value inside its scope's stored object: the order's `details` (voucher scope), a
 * ledger entry, a product line, an allocation, an additional cost. A custom field's value, and a keyed matrix
 * field's (one marked x that the WMS offers), is under `custom.<key>` in the same object. One table: the comparison and the order page both read values through it.
 */
export const STORED_PATH: Readonly<Record<string, string>> = {
  voucherType: "voucher.typeName", seriesName: "voucher.seriesName", narration: "voucher.narration", costCentreClass: "voucher.costCentreClass",
  voucherClass: "voucher.voucherClass", priceLevel: "voucher.priceLevel", gstRegistration: "voucher.gstRegistration",
  referenceNo: "order.orderNos", orderDate: "order.orderDate", paymentTerms: "order.paymentTerms", otherReferences: "order.otherReferences", deliveryTerms: "order.deliveryTerms",
  dispatchedThrough: "dispatch.dispatchedThrough", destination: "dispatch.destination", carrier: "dispatch.carrier",
  buyerBillTo: "buyer.billTo", buyerAddressType: "buyer.addressType", buyerMailingName: "buyer.mailingName", buyerAddress: "buyer.address", buyerCountry: "buyer.country",
  buyerState: "buyer.state", buyerRegType: "buyer.registrationType", gstin: "buyer.gstin", buyerBillOfEntry: "buyer.billOfEntry", buyerSec7: "buyer.section7", placeOfSupply: "buyer.placeOfSupply", buyerPincode: "buyer.pincode",
  consignee: "consignee.billTo", consigneeMailingName: "consignee.mailingName", consigneeAddressType: "consignee.addressType", consigneeAddress: "consignee.address",
  consigneeState: "consignee.state", consigneeCountry: "consignee.country", consigneeGstin: "consignee.gstin", consigneePincode: "consignee.pincode",
  supplyType: "supplyType", originalSalesNature: "originalSalesNature", isOptional: "states.optional", isPostDated: "states.postDated", isCancelled: "states.cancelled", changeMode: "states.changeMode",
  partyName: "name", amount: "amountPaise", drCr: "side", ledgerRate: "rate", ledgerNarration: "narration", ledgerDescription: "description",
  itemName: "item", itemDescription: "description", quantity: "quantity", rate: "ratePaise", ratePer: "uom", lineAmount: "amountPaise", discPct: "discPct", discAmount: "discountPaise", mrp: "mrpPaise",
  gstRateDetails: "gst.rateDetails", gstSource: "gst.source", gstSourceType: "gst.sourceType", gstTaxability: "gst.taxability", gstNature: "gst.nature", gstClassification: "gst.classification",
  igstRate: "gst.igstRate", cgstRate: "gst.cgstRate", sgstRate: "gst.sgstRate", reverseCharge: "gst.reverseCharge", itcEligible: "gst.itcEligible", taxableValue: "gst.taxablePaise",
  hsnDetails: "hsn.details", hsnSource: "hsn.source", hsnSourceType: "hsn.sourceType", hsnClassification: "hsn.classification", hsn: "hsn.code", hsnDescription: "hsn.description",
  allocTrackingNo: "trackingNo", allocOrderNo: "orderNo", allocQuantity: "quantity", allocRate: "ratePaise", allocRatePer: "ratePer", allocAmount: "amountPaise", dueDate: "dueDate",
  allocDiscPct: "discPct", allocDiscAmount: "discountPaise", allocCostTracking: "costTracking",
  addlCostLedger: "ledger", addlCostPct: "percent", addlCostAmount: "amountPaise",
};

/** Cost-centre fields live in a ledger entry's list of allocations, not in one value. */
export const COST_CENTRE_KEYS: ReadonlySet<string> = new Set(["categoryName", "costCentre", "costCentreAmount"]);

export const storedPath = (f: Pick<ConfiguredField, "key" | "isCustom" | "keyed">): string | null => (isKeyed(f) ? `custom.${f.key}` : (STORED_PATH[f.key] ?? null));

/** A stored value by dotted path. */
export function readPath(o: unknown, path: string): unknown {
  let v: unknown = o;
  for (const k of path.split(".")) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** A stored value as text for the screens: rupees for paise, Yes/No for booleans. */
export function displayValue(f: Pick<ConfiguredField, "type" | "key">, v: unknown, path: string | null): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && path && /Paise$/.test(path)) return `₹${(v / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (typeof v === "string" && path === "side") return v === "dr" ? "Dr" : v === "cr" ? "Cr" : v;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** The stored-setting row from the settings table's own columns (null-safe). */
export function settingFromRow(r: {
  fieldKey: string; isCustom: boolean; scope: string; label: string | null; section: string | null; displayOrder: number | null; requirement: string | null; condition: unknown;
  fieldType: string | null; options: string[] | null; inForm: boolean; inImport: boolean; onOrderPage: boolean; status: string; rowVersion: number;
}): FieldSetting {
  return {
    fieldKey: r.fieldKey,
    isCustom: r.isCustom,
    scope: (FIELD_SCOPES as readonly string[]).includes(r.scope) ? (r.scope as FieldScope) : "voucher",
    label: r.label,
    section: r.section,
    displayOrder: r.displayOrder,
    requirement: r.requirement === "mandatory" || r.requirement === "optional" || r.requirement === "conditional" ? r.requirement : null,
    condition: isCondition(r.condition) ? r.condition : null,
    fieldType: r.fieldType && (CUSTOM_TYPES as readonly string[]).includes(r.fieldType) ? (r.fieldType as SoFieldType) : null,
    options: r.options,
    inForm: r.inForm,
    inImport: r.inImport,
    onOrderPage: r.onOrderPage,
    status: r.status === "retired" ? "retired" : "active",
    rowVersion: r.rowVersion,
  };
}

/** Whether a stored value is one of the vocabulary's conditions (anything else is ignored, never run). */
export function isCondition(v: unknown): v is Condition {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
  if (c.op === "in" || c.op === "notIn") return typeof c.field === "string" && strings(c.values);
  if (c.op === "given") return typeof c.field === "string";
  if (c.op === "ledgerKind") return strings(c.values) && (c.values as string[]).every((s) => s === "customer" || s === "other");
  return false;
}
