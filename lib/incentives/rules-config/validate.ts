import {
  ELIGIBILITY_SUBJECTS,
  SECTIONS,
  SETTING,
  SLAB_VALUE_TYPES,
  hasDelaySteps,
  hasSlabs,
  settingsFor,
  type CategoryCode,
  type DelayStep,
  type EligibilityRow,
  type IncentiveConfig,
  type SectionKey,
  type SettingDef,
  type SettingValue,
  type Slab,
} from "./spec";

/**
 * Checking an Incentive Rules configuration. Pure; the server runs it on every save, submission, approval and
 * publication (the screen runs it too, only for its messages).
 *
 *   readConfig     — turns untrusted input into a configuration, refusing anything that isn't one of the catalogue's
 *                    shapes (an unknown setting, a value of the wrong kind): nothing is ever stored that the catalogue
 *                    doesn't define, and nothing a setting holds is ever run.
 *   checkConfig    — every PROBLEM (a value that is wrong) and everything MISSING (a required value not yet set).
 *                    A draft may be saved with things missing, never with problems; it can be submitted, approved
 *                    and published only with neither.
 *   diffConfigs    — what changed between two configurations, setting by setting, for comparison and history.
 */

export interface Issue {
  section: SectionKey;
  /** The setting's key, or "slabs" / "delaySteps" / "eligibility" (with a row number in the message). */
  where: string;
  message: string;
}

export interface CheckContext {
  /** Employee roles a "role" eligibility row may name (the employees' own role values). */
  roles: readonly string[];
  /** The category the configuration is for (absent: Category A). */
  category?: CategoryCode;
}

const sectionLabel = (k: SectionKey) => SECTIONS.find((s) => s.key === k)!.label;
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isInt = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
/** Paise: up to ₹10,00,000 crore — far beyond any order, well inside a safe integer. */
const MAX_PAISE = 1_000_000_000_000_000;
export const PPM_100 = 1_000_000;

/** Whether a setting applies (its condition holds, or it has none). */
export function applies(def: SettingDef, settings: Readonly<Record<string, SettingValue>>): boolean {
  if (!def.requiredWhen) return true;
  const v = settings[def.requiredWhen.key];
  if (v === undefined) return false;
  return Array.isArray(v) ? v.some((x) => def.requiredWhen!.values.includes(x)) : def.requiredWhen.values.includes(String(v));
}

/** Why a setting's value isn't valid for it, or null. */
export function settingProblem(def: SettingDef, v: unknown): string | null {
  const choices = new Set((def.choices ?? []).map((c) => c.value));
  switch (def.kind) {
    case "choice":
      return typeof v === "string" && choices.has(v) ? null : `Choose one of the listed options.`;
    case "multi":
    case "ordered": {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !choices.has(x))) return "Only the listed options can be chosen.";
      if (new Set(v).size !== v.length) return "An option is chosen twice.";
      if (def.kind === "ordered" && v.length === 0) return "Choose at least one, in order.";
      return null;
    }
    case "amount":
      return isInt(v, 0, MAX_PAISE) ? null : "Enter an amount of ₹0 or more.";
    case "cap":
      return v === "none" || isInt(v, 0, MAX_PAISE) ? null : `Choose "${def.noneLabel ?? "No limit"}" or enter an amount of ₹0 or more.`;
    case "integer":
      return isInt(v, def.min ?? 0, def.max ?? Number.MAX_SAFE_INTEGER) ? null : `Enter a whole number from ${def.min ?? 0} to ${def.max ?? "any"}.`;
    case "rate":
      return isInt(v, 0, PPM_100) ? null : "Enter a percentage from 0% to 100%.";
  }
}

function slabIssues(slabs: readonly Slab[], gaps: SettingValue | undefined): string[] {
  const out: string[] = [];
  if (slabs.length > 20) out.push("At most 20 slabs.");
  const codes = new Set<string>();
  slabs.forEach((s, i) => {
    const n = `Slab ${i + 1}`;
    if (typeof s.lineCode !== "string" || !/^[A-Za-z0-9.\-]{1,10}$/.test(s.lineCode)) out.push(`${n}: its line code must be 1–10 letters, digits, dots or dashes.`);
    else if (codes.has(s.lineCode.toLowerCase())) out.push(`${n}: line code ${s.lineCode} is used twice.`);
    else codes.add(s.lineCode.toLowerCase());
    if (typeof s.label !== "string" || !s.label.trim() || s.label.length > 120) out.push(`${n}: give it a label of up to 120 characters.`);
    if (!isInt(s.fromPaise, 0, MAX_PAISE) || !isInt(s.toPaise, 0, MAX_PAISE)) out.push(`${n}: its from and to amounts must be ₹0 or more.`);
    else if (s.toPaise <= s.fromPaise) out.push(`${n}: it must end above where it starts.`);
    if (!(SLAB_VALUE_TYPES as readonly string[]).includes(s.valueType)) out.push(`${n}: choose a percentage or a fixed amount.`);
    else if (s.valueType === "percent") {
      if (!isInt(s.ratePpm, 0, PPM_100)) out.push(`${n}: its rate must be from 0% to 100%.`);
      if (s.fixedPaise !== null) out.push(`${n}: a percentage slab has no fixed amount.`);
    } else {
      if (!isInt(s.fixedPaise, 0, MAX_PAISE)) out.push(`${n}: its fixed amount must be ₹0 or more.`);
      if (s.ratePpm !== null) out.push(`${n}: a fixed-amount slab has no rate.`);
    }
    if (s.capPaise !== null && !isInt(s.capPaise, 0, MAX_PAISE)) out.push(`${n}: its limit must be ₹0 or more, or none.`);
  });
  for (let i = 1; i < slabs.length; i++) {
    const a = slabs[i - 1]!, b = slabs[i]!;
    if (!isInt(a.toPaise) || !isInt(b.fromPaise)) continue;
    if (b.fromPaise < a.fromPaise) out.push(`Slabs must be in order: slab ${i + 1} starts below slab ${i}.`);
    else if (b.fromPaise < a.toPaise) out.push(`Slabs ${i} and ${i + 1} overlap.`);
    else if (b.fromPaise > a.toPaise && gaps !== "allow") out.push(`There is a gap between slabs ${i} and ${i + 1}: close it, or set "Gaps between slabs" to allow gaps.`);
  }
  return out;
}

function stepIssues(steps: readonly DelayStep[]): string[] {
  const out: string[] = [];
  if (steps.length > 10) out.push("At most 10 delay steps.");
  steps.forEach((s, i) => {
    const n = `Step ${i + 1}`;
    const last = i === steps.length - 1;
    if (!isInt(s.fromDays, 0, 3650)) out.push(`${n}: its first day must be a whole number of days.`);
    if (last) {
      if (s.toDays !== null) out.push(`${n}: the last step has no end (it covers every later day).`);
    } else if (!isInt(s.toDays, 0, 3650)) out.push(`${n}: give its last day (only the last step is open-ended).`);
    else if (isInt(s.fromDays) && s.toDays <= s.fromDays) out.push(`${n}: it must end after it starts.`);
    if (!isInt(s.multiplierPpm, 0, PPM_100)) out.push(`${n}: its multiplier must be from 0% to 100%.`);
  });
  if (steps.length && steps[0]!.fromDays !== 0) out.push("The first step must start at day 0.");
  for (let i = 1; i < steps.length; i++) if (steps[i]!.fromDays !== steps[i - 1]!.toDays) out.push(`Step ${i + 1} must start where step ${i} ends.`);
  return out;
}

function eligibilityIssues(rows: readonly EligibilityRow[], ctx: CheckContext): string[] {
  const out: string[] = [];
  if (rows.length > 500) out.push("At most 500 eligibility rows.");
  rows.forEach((r, i) => {
    const n = `Row ${i + 1}`;
    if (!(ELIGIBILITY_SUBJECTS as readonly string[]).includes(r.subjectType)) out.push(`${n}: choose an employee, a department or a role.`);
    else if (r.subjectType === "role") {
      if (!r.role || !ctx.roles.includes(r.role) || r.subjectId !== null) out.push(`${n}: choose one of the employee roles.`);
    } else if (!isUuid(r.subjectId) || r.role !== null) out.push(`${n}: choose the ${r.subjectType}.`);
    if (typeof r.subjectLabel !== "string" || !r.subjectLabel.trim() || r.subjectLabel.length > 160) out.push(`${n}: its name is missing.`);
    if (r.mode !== "include" && r.mode !== "exclude") out.push(`${n}: choose include or exclude.`);
    if (!isDay(r.effectiveFrom)) out.push(`${n}: give the date it starts.`);
    if (r.effectiveTo !== null && (!isDay(r.effectiveTo) || (isDay(r.effectiveFrom) && r.effectiveTo < r.effectiveFrom))) out.push(`${n}: its end date must be on or after its start date.`);
  });
  // The same person, department or role, included (or excluded) twice for overlapping dates, is ambiguous.
  const id = (r: EligibilityRow) => `${r.subjectType}|${r.subjectId ?? r.role}|${r.mode}`;
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!, b = rows[j]!;
      if (id(a) !== id(b) || !isDay(a.effectiveFrom) || !isDay(b.effectiveFrom)) continue;
      const aEnd = a.effectiveTo ?? "9999-12-31", bEnd = b.effectiveTo ?? "9999-12-31";
      if (a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd) out.push(`Rows ${i + 1} and ${j + 1} cover ${a.subjectLabel} for overlapping dates.`);
    }
  return out;
}

/** Every problem and everything missing. `problems` must be empty to save; both must be empty to submit or publish. */
export function checkConfig(c: IncentiveConfig, ctx: CheckContext): { problems: Issue[]; missing: Issue[] } {
  const category = ctx.category ?? "A";
  const defs = settingsFor(category);
  const defOf = new Map(defs.map((d) => [d.key, d]));
  const problems: Issue[] = [];
  const missing: Issue[] = [];
  for (const [key, value] of Object.entries(c.settings)) {
    const def = defOf.get(key);
    if (!def) {
      problems.push({ section: "general", where: key, message: SETTING[key] ? `“${SETTING[key]!.label}” isn't a Category ${category} setting.` : `“${key}” isn't an Incentive Rules setting.` });
      continue;
    }
    const p = settingProblem(def, value);
    if (p) problems.push({ section: def.section, where: key, message: `${def.label}: ${p}` });
  }
  for (const def of defs) {
    if (def.required && applies(def, c.settings) && c.settings[def.key] === undefined) {
      missing.push({ section: def.section, where: def.key, message: `${def.label} (${sectionLabel(def.section)}) isn't set.` });
    }
  }
  if (hasSlabs(category)) {
    for (const m of slabIssues(c.slabs, c.settings["slabs.gaps"])) problems.push({ section: "slabs", where: "slabs", message: m });
    if (!c.slabs.length) missing.push({ section: "slabs", where: "slabs", message: "No incentive slab yet (Incentive Slabs)." });
  } else if (c.slabs.length) problems.push({ section: "qualification", where: "slabs", message: `Category ${category} has no incentive slabs; remove them.` });
  if (hasDelaySteps(category)) {
    for (const m of stepIssues(c.delaySteps)) problems.push({ section: "delay", where: "delaySteps", message: m });
    if (!c.delaySteps.length) missing.push({ section: "delay", where: "delaySteps", message: "No collection delay step yet (Collection and Payment Delay)." });
  } else if (c.delaySteps.length) problems.push({ section: "rewards", where: "delaySteps", message: `Category ${category} isn't collected, so it has no delay steps; remove them.` });
  for (const m of eligibilityIssues(c.eligibility, ctx)) problems.push({ section: "people", where: "eligibility", message: m });
  if (!c.eligibility.some((r) => r.mode === "include")) missing.push({ section: "people", where: "eligibility", message: "Nobody is included yet (Salesperson Eligibility)." });
  if (category === "B") for (const p of categoryBIssues(c)) problems.push(p);
  if (category === "C") {
    const vf = c.settings["basis.voucherFilter"];
    if (Array.isArray(vf) && !vf.includes("cancelled")) problems.push({ section: "general", where: "basis.voucherFilter", message: "Orders left out: a cancelled order is never a customer's transaction; choose Cancelled." });
  }
  if (category === "E" && typeof c.settings["e.minAward"] === "number" && typeof c.settings["e.maxAward"] === "number" && (c.settings["e.minAward"] as number) > (c.settings["e.maxAward"] as number))
    problems.push({ section: "rewards", where: "e.minAward", message: "The smallest award for a meeting is more than the largest." });
  return { problems, missing };
}

/**
 * Category B's cross-checks, from its confirmed decisions: cancelled orders are always left out (they must be among
 * "Orders left out"). The narrowed choices of the recovery settings are checked as each setting's own choices.
 */
function categoryBIssues(c: IncentiveConfig): Issue[] {
  const out: Issue[] = [];
  const vf = c.settings["basis.voucherFilter"];
  if (Array.isArray(vf) && !vf.includes("cancelled")) out.push({ section: "qualification", where: "basis.voucherFilter", message: "Orders left out: cancelled orders are always left out of Category B (confirmed decision); choose Cancelled." });
  return out;
}

/* ── reading untrusted input ─────────────────────────────────────────── */

const pick = <T extends object>(o: unknown, keys: readonly (keyof T)[]): Record<string, unknown> | null => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const extra = Object.keys(o).filter((k) => !keys.includes(k as keyof T));
  return extra.length ? null : (o as Record<string, unknown>);
};
const SLAB_KEYS = ["lineCode", "label", "fromPaise", "toPaise", "valueType", "ratePpm", "fixedPaise", "capPaise"] as const;
const STEP_KEYS = ["fromDays", "toDays", "multiplierPpm"] as const;
const ELIG_KEYS = ["subjectType", "subjectId", "role", "subjectLabel", "mode", "effectiveFrom", "effectiveTo"] as const;
const scalar = (v: unknown) => v === null || typeof v === "string" || typeof v === "number";

/**
 * A configuration from untrusted input (a form, a request), or why it can't be one. Only the catalogue's shapes are
 * accepted: plain strings, numbers and lists of strings for settings; the exact fields of a slab, step or row.
 */
export function readConfig(raw: unknown): { ok: true; config: IncentiveConfig } | { ok: false; error: string } {
  const top = pick<IncentiveConfig>(raw, ["settings", "slabs", "delaySteps", "eligibility"]);
  if (!top) return { ok: false, error: "That isn't an Incentive Rules configuration." };
  const settingsIn = top.settings;
  if (!settingsIn || typeof settingsIn !== "object" || Array.isArray(settingsIn)) return { ok: false, error: "The settings couldn't be read." };
  const settings: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(settingsIn as Record<string, unknown>)) {
    if (!SETTING[k]) return { ok: false, error: `“${k}” isn't an Incentive Rules setting.` };
    if (v === null || v === undefined || v === "") continue; // not set
    if (typeof v === "string" || typeof v === "number") settings[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) settings[k] = [...v] as string[];
    else return { ok: false, error: `${SETTING[k]!.label}: that value can't be read.` };
  }
  const list = <T>(v: unknown, keys: readonly string[], what: string): T[] | string => {
    if (!Array.isArray(v)) return `The ${what} couldn't be read.`;
    const out: T[] = [];
    for (const item of v) {
      const o = pick(item, keys as never);
      if (!o || !Object.values(o).every(scalar)) return `A ${what.replace(/s$/, "")} couldn't be read.`;
      out.push(Object.fromEntries(keys.map((k) => [k, o[k] ?? null])) as T);
    }
    return out;
  };
  const slabs = list<Slab>(top.slabs, SLAB_KEYS, "slabs");
  if (typeof slabs === "string") return { ok: false, error: slabs };
  const delaySteps = list<DelayStep>(top.delaySteps, STEP_KEYS, "delay steps");
  if (typeof delaySteps === "string") return { ok: false, error: delaySteps };
  const eligibility = list<EligibilityRow>(top.eligibility, ELIG_KEYS, "eligibility rows");
  if (typeof eligibility === "string") return { ok: false, error: eligibility };
  return { ok: true, config: { settings, slabs, delaySteps, eligibility } };
}

/* ── comparing ───────────────────────────────────────────────────────── */

export interface Difference {
  section: SectionKey;
  label: string;
  before: string;
  after: string;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (ppm: number) => `${(ppm / 10_000).toLocaleString("en-IN", { maximumFractionDigits: 4 })}%`;

/** A setting's value in words. */
export function settingText(def: SettingDef, v: SettingValue | undefined): string {
  if (v === undefined) return "Not set";
  const label = (x: string) => def.choices?.find((c) => c.value === x)?.label ?? x;
  switch (def.kind) {
    case "choice":
      return label(String(v));
    case "multi":
      return Array.isArray(v) && v.length ? v.map(label).join(", ") : "None";
    case "ordered":
      return Array.isArray(v) ? v.map((x, i) => `${i + 1}. ${label(x)}`).join("  ") : String(v);
    case "amount":
      return typeof v === "number" ? rupees(v) : String(v);
    case "cap":
      return v === "none" ? (def.noneLabel ?? "No limit") : typeof v === "number" ? rupees(v) : String(v);
    case "integer":
      return String(v);
    case "rate":
      return typeof v === "number" ? pct(v) : String(v);
  }
}
export const slabText = (s: Slab) => `${s.lineCode} ${s.label}: ${rupees(s.fromPaise)} – ${rupees(s.toPaise)} at ${s.valueType === "percent" ? pct(s.ratePpm ?? 0) : rupees(s.fixedPaise ?? 0)}${s.capPaise !== null ? `, at most ${rupees(s.capPaise)}` : ""}`;
export const stepText = (s: DelayStep) => `${s.fromDays}–${s.toDays ?? "∞"} days: ${pct(s.multiplierPpm)}`;
export const eligibilityText = (r: EligibilityRow) => `${r.mode === "include" ? "Include" : "Exclude"} ${r.subjectType} ${r.subjectLabel} from ${r.effectiveFrom}${r.effectiveTo ? ` to ${r.effectiveTo}` : ""}`;
export { rupees, pct };

/** What changed from `a` to `b`: each setting, and each list as a whole. */
export function diffConfigs(a: IncentiveConfig, b: IncentiveConfig, category: CategoryCode = "A"): Difference[] {
  const out: Difference[] = [];
  for (const def of settingsFor(category)) {
    const x = settingText(def, a.settings[def.key]);
    const y = settingText(def, b.settings[def.key]);
    if (x !== y) out.push({ section: def.section, label: def.label, before: x, after: y });
  }
  const lists: [SectionKey, string, string[], string[]][] = [
    ["slabs", "Incentive slabs", a.slabs.map(slabText), b.slabs.map(slabText)],
    ["delay", "Collection delay steps", a.delaySteps.map(stepText), b.delaySteps.map(stepText)],
    ["people", "Salesperson eligibility", a.eligibility.map(eligibilityText), b.eligibility.map(eligibilityText)],
  ];
  for (const [section, label, x, y] of lists) if (x.join("\n") !== y.join("\n")) out.push({ section, label, before: x.join("\n") || "None", after: y.join("\n") || "None" });
  return out;
}

/* ── effective dates ─────────────────────────────────────────────────── */

export const isMonthStart = (d: string) => isDay(d) && d.endsWith("-01");
/** The day before a yyyy-mm-dd date. */
export const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
export { isDay };
