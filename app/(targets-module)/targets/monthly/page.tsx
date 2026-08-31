import { PeriodPage } from "@/components/targets/period-page";

export const dynamic = "force-dynamic";

export default function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; period?: string; rep?: string }>;
}) {
  return (
    <PeriodPage
      kind="month"
      title="Monthly Forecast"
      lede="Updated on the 27th of every month. Estimates without a note get flagged."
      searchParams={searchParams}
    />
  );
}
