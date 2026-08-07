import { requireAdmin } from "@/lib/auth/current";
import {
  findOverlappingSlabs,
  listIncentiveSlabs,
  listLookupItems,
} from "@/lib/queries/master-data";
import { LibrariesManager } from "@/components/admin/master/libraries-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function LibrariesPage() {
  await requireAdmin();
  const [lookups, slabs] = await Promise.all([listLookupItems(), listIncentiveSlabs()]);

  // Computed on the server so the warning can't disagree with the data.
  const overlaps = findOverlappingSlabs(slabs).map(
    ([a, b]) =>
      [
        a.label ?? `${a.overdueFromDays}–${a.overdueToDays ?? "\u221E"}`,
        b.label ?? `${b.overdueFromDays}–${b.overdueToDays ?? "\u221E"}`,
      ] as [string, string],
  );

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="System Libraries"
        lede={
          <>
            Dropdown options and incentive slabs, editable without a developer. {lookups.length}{" "}
            options · {slabs.length} slabs.
          </>
        }
      />
      <LibrariesManager lookups={lookups} slabs={slabs} overlaps={overlaps} />
    </div>
  );
}
