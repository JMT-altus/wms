/** Shown instead of an Incentive Calculation screen to an admin who holds none of its rights. */
export function NoCalcAccess() {
  return (
    <div role="note" className="rounded-section px-5 py-4 text-[14px] text-ink-muted" style={{ background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
      <strong className="text-ink-strong">No access.</strong> Incentive calculations need one of the &ldquo;Incentive Calculation&rdquo; permissions, which a super-admin grants in Field Permissions.
    </div>
  );
}
