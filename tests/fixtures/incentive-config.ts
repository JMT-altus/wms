import { REFERENCE_TEMPLATE, SETTINGS, type EligibilityRow, type IncentiveConfig } from "@/lib/incentives/rules-config/spec";

/**
 * A COMPLETE Incentive Rules configuration for tests: the reference template with every remaining required setting set
 * to its first choice (or a valid number), and one eligibility row. The choices are arbitrary test values, not business
 * decisions.
 */
export function completeConfig(over: Partial<IncentiveConfig> = {}, eligibility?: EligibilityRow[]): IncentiveConfig {
  const settings: IncentiveConfig["settings"] = { ...REFERENCE_TEMPLATE.settings };
  for (const d of SETTINGS) {
    if (settings[d.key] !== undefined) continue;
    settings[d.key] = d.kind === "choice" ? d.choices![0]!.value : d.kind === "multi" ? [] : d.kind === "ordered" ? [d.choices![0]!.value] : d.kind === "cap" ? "none" : d.kind === "integer" ? (d.min ?? 0) + 1 : 100;
  }
  return {
    ...REFERENCE_TEMPLATE,
    settings,
    eligibility: eligibility ?? [{ subjectType: "role", subjectId: null, role: "both", subjectLabel: "both", mode: "include", effectiveFrom: "2026-04-01", effectiveTo: null }],
    ...over,
  };
}
