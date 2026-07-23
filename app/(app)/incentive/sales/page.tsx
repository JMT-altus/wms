import { requireUser } from "@/lib/auth/current";
import { getMySales } from "@/lib/queries/incentive-views";
import { SalesTable } from "@/components/incentive/sales-table";
import { LogSale } from "@/components/incentive/log-sale";
import { EmptyState, PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

export default async function MySalesPage() {
  const me = await requireUser();
  const sales = await getMySales(me.id);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <PageHead eyebrow="MY SALES" title="My Sales" sub="Log every deal you close. Collections drive the decay — tap a row for its receipts." />
      <div className="mb-5"><LogSale /></div>
      {sales.length === 0 ? (
        <EmptyState title="No sales logged yet." sub="Tap “+ Log a sale” to record your first deal — customer, amount, category and dates." />
      ) : (
        <SalesTable sales={sales} />
      )}
    </main>
  );
}
