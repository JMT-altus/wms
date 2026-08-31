import { PeriodPage } from "@/components/targets/period-page";

export const dynamic = "force-dynamic";

export default function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; period?: string; rep?: string }>;
}) {
  return (
    <PeriodPage
      kind="quarter"
      title="Quarterly Forecast"
      lede="Four buckets. Seeded from the annual number, then edited for seasonality."
      searchParams={searchParams}
    />
  );
}
