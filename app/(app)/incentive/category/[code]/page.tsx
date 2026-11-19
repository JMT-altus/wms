import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { PageHead } from "@/components/incentive/empty-state";
import { CategoryACalculationScreen } from "@/components/admin/master/incentive-rules/calculation-screen";
import { CATEGORY_LABEL } from "@/lib/incentives/rules-config/spec";

export const dynamic = "force-dynamic";

/**
 * Incentive Tracker → Categories C–G: one category's calculation for a month (the same screen and services as Admin &
 * Master Setup → Incentive Calculation). Provisional figures need an Incentive Calculation permission, checked on the
 * server; a salesperson sees their approved and paid amounts on My Incentives instead.
 */
export default async function TrackerCategoryPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ program?: string; month?: string }> }) {
  const code = (await params).code.toUpperCase();
  const category = (["C", "D", "E", "F", "G"] as const).find((c) => c === code);
  if (!category) notFound();
  const me = await requireUser();
  const rights = await incentiveCalcRights(me);
  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <nav aria-label="Categories" className="mb-3 flex flex-wrap gap-1.5 text-[12.5px] font-bold">
        {(["C", "D", "E", "F", "G"] as const).map((c) => (
          <a key={c} href={`/incentive/category/${c.toLowerCase()}`} aria-current={c === category ? "page" : undefined} className="rounded-pill px-3 py-1" style={c === category ? { background: "#0B4FB8", color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}>
            {c} · {CATEGORY_LABEL[c]}
          </a>
        ))}
      </nav>
      <CategoryACalculationScreen me={me} rights={rights} searchParams={await searchParams} basePath={`/incentive/category/${category.toLowerCase()}`} variant="tracker" category={category} head={<PageHead eyebrow={`CATEGORY ${category} · ${CATEGORY_LABEL[category].toUpperCase()}`} title={`Category ${category}`} sub="Calculated from the published Incentive Rules for the month. Nothing applies until a complete configuration is approved and published." />} />
    </main>
  );
}
