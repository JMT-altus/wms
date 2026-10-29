import { requireAdmin } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getFieldMatrix } from "@/lib/queries/master-data";
import { FieldAccessManager } from "@/components/admin/master/field-access-manager";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

export default async function AccessControlPage() {
  const me = await requireAdmin();
  const matrix = await getFieldMatrix();
  const overrides = matrix.grants.filter((g) => g.subjectType !== "everyone").length;

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Field Permissions"
        lede={
          <>
            Who may edit sensitive fields such as quantities and average rates, who may do what in Collections, and who may view and decide leave requests.{" "}
            {matrix.people.length} people · {matrix.departments.length} departments · {overrides} override
            {overrides === 1 ? "" : "s"}.
          </>
        }
      />
      {/* Only decides whether the sensitive rows are editable here; the action checks again. */}
      <FieldAccessManager matrix={matrix} canManageSensitive={isSuperAdmin(me.email)} />
    </div>
  );
}
