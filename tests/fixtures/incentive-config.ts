import { referenceTemplateFor, settingsFor, type CategoryCode, type EligibilityRow, type IncentiveConfig } from "@/lib/incentives/rules-config/spec";

/**
 * A COMPLETE Incentive Rules configuration for tests: the category's reference template with every remaining required
 * setting set to its first choice (or a valid number), and one eligibility row. The choices are arbitrary test values,
 * not business decisions. A conditional setting is filled when the setting it depends on is itself required (so a
 * Category A configuration is exactly what it was before Category B's optional settings existed).
 */
export function completeConfig(over: Partial<IncentiveConfig> = {}, eligibility?: EligibilityRow[], category: CategoryCode = "A"): IncentiveConfig {
  const template = referenceTemplateFor(category);
  const settings: IncentiveConfig["settings"] = { ...template.settings };
  const defs = settingsFor(category);
  const required = new Set(defs.filter((d) => d.required).map((d) => d.key));
  for (const d of defs) {
    if (settings[d.key] !== undefined || !d.required) continue;
    if (d.requiredWhen && !required.has(d.requiredWhen.key)) continue;
    settings[d.key] = d.kind === "choice" ? d.choices![0]!.value : d.kind === "multi" ? (d.key === "basis.voucherFilter" && category === "B" ? ["cancelled"] : []) : d.kind === "ordered" ? [d.choices![0]!.value] : d.kind === "cap" ? "none" : d.kind === "integer" ? (d.min ?? 0) + 1 : d.kind === "rate" ? 10_000 : 100;
  }
  return {
    ...template,
    settings,
    eligibility: eligibility ?? [{ subjectType: "role", subjectId: null, role: "both", subjectLabel: "both", mode: "include", effectiveFrom: "2026-04-01", effectiveTo: null }],
    ...over,
  };
}
