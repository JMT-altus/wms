/** Incentive Management: reading the filters from the address (anything unexpected falls back to the default). */

/** A required month (yyyy-mm → yyyy-mm-01); the current month when absent or malformed. */
export const monthParam = (m: string | undefined, today: string) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : `${today.slice(0, 7)}-01`);
/** An optional month (yyyy-mm → yyyy-mm-01); null when absent or malformed. */
export const optionalMonth = (m: string | undefined) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null);
export const categoryParam = (c: string | undefined) => (c && /^[A-G]$/.test(c) ? c : null);
export const choiceParam = (v: string | undefined, allowed: readonly { value: string }[], fallback: string) => (v !== undefined && allowed.some((a) => a.value === v) ? v : fallback);

/** One programme by id, or every programme ("all", absent or unknown). */
export function programsParam<P extends { id: string }>(v: string | undefined, programs: P[]): { program: string; selected: P[] } {
  const one = v && v !== "all" ? programs.find((p) => p.id === v) : undefined;
  return one ? { program: one.id, selected: [one] } : { program: "all", selected: programs };
}
