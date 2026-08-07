import { requireAdmin } from "@/lib/auth/current";
import {
  listCategories,
  listImportBatches,
  listTallyMappings,
} from "@/lib/queries/master-data";
import { ImportManager } from "@/components/admin/master/import-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function DataImportPage() {
  await requireAdmin();
  const [batches, mappings, categories] = await Promise.all([
    listImportBatches(),
    listTallyMappings(),
    listCategories(),
  ]);

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Data Import &amp; Tally Mapping"
        lede={
          <>
            Upload a Google Sheets or Tally export, map its columns, and import. {batches.length}{" "}
            past import{batches.length === 1 ? "" : "s"} · {mappings.length} Tally group mappings.
          </>
        }
      />
      <ImportManager batches={batches} mappings={mappings} categories={categories} />
    </div>
  );
}
