import { PeriodPage } from "@/components/targets/period-page";

export const dynamic = "force-dynamic";

export default function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; period?: string; rep?: string }>;
}) {
  return (
    <PeriodPage
      kind="week"
      title="Weekly Forecast"
      lede="Updated every Friday before logout. The month above divides into these."
      searchParams={searchParams}
    />
  );
}
