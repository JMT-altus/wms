import { requireModuleAccess } from "@/lib/auth/module-access";
import {
  getCompanyAnnualTarget,
  listGrowthSplits,
  repAllocations,
  resolveExistingPct,
} from "@/lib/queries/targets";
import { fyLabel, fyStartYearForDate } from "@/lib/targets/period";
import { istYmd } from "@/lib/weekly-goals/week";
import { AnnualSetup } from "@/components/targets/annual-setup";
import { TargetsHead, YearSwitcher } from "@/components/targets/ui";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ fy?: string }>;
}

export default async function AnnualTargetsPage({ searchParams }: PageProps) {
  const me = await requireModuleAccess("targets");
  const sp = await searchParams;

  const parsed = Number(sp.fy);
  const fyStartYear = Number.isInteger(parsed) ? parsed : fyStartYearForDate(istYmd(new Date()));

  const [companyTargetPaise, splits, repsAll] = await Promise.all([
    getCompanyAnnualTarget(fyStartYear),
    listGrowthSplits(fyStartYear),
    repAllocations(fyStartYear),
  ]);

  // Own only, unless admin — the same rule the rest of the module follows.
  const reps = me.isAdmin ? repsAll : repsAll.filter((r) => r.employeeId === me.id);
  // A rep's headline is THEIR allocation, not the company's number. Passing the
  // company figure through would put the whole business's target on a
  // salesperson's screen, which is not theirs to see.
  const headlineTarget = me.isAdmin
    ? companyTargetPaise
    : (reps[0]?.allocatedPaise ?? 0);
  const label = fyLabel(fyStartYear);

  return (
    <>
      <TargetsHead
        title="Annual Forecast"
        lede={
          me.isAdmin
            ? "Set the company number for the year, then hand each salesperson their share. Quarters, months and weeks seed automatically."
            : "Your share of the year, and how your customer rows add up against it."
        }
        right={<YearSwitcher fyStartYear={fyStartYear} label={label} basePath="/targets/annual" />}
      />
      <AnnualSetup
        fyStartYear={fyStartYear}
        fyLabel={label}
        companyTargetPaise={headlineTarget}
        orgExistingPct={resolveExistingPct(splits, null)}
        reps={reps}
        isAdmin={me.isAdmin}
      />
    </>
  );
}
