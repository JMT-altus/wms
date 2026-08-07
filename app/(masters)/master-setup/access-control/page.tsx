import { requireAdmin } from "@/lib/auth/current";
import { getFieldMatrix } from "@/lib/queries/master-data";
import { FieldAccessManager } from "@/components/admin/master/field-access-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function AccessControlPage() {
  await requireAdmin();
  const matrix = await getFieldMatrix();
  const overrides = matrix.grants.filter((g) => g.subjectType !== "everyone").length;

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Field Permissions"
        lede={
          <>
            Who may edit sensitive fields such as quantities and average rates. {matrix.people.length}{" "}
            people · {matrix.departments.length} departments · {overrides} override
            {overrides === 1 ? "" : "s"}.
          </>
        }
      />
      <FieldAccessManager matrix={matrix} />
    </div>
  );
}
