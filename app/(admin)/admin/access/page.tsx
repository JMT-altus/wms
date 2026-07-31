import { requireAdmin } from "@/lib/auth/current";
import { getAccessMatrix } from "@/lib/queries/module-access";
import { AccessManager } from "@/components/admin/access-manager";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  await requireAdmin();
  const matrix = await getAccessMatrix();

  const overrides = matrix.grants.filter((g) => g.subjectType !== "everyone").length;

  return (
    <div>
      <header className="mb-8">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">
          Admin · Access
        </div>
        <h1
          className="mt-1 text-ink-strong"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          Module Access
        </h1>
        <p className="text-body-lg text-ink-subtle mt-2 max-w-3xl tabular-nums">
          Decide which hub workspaces each person can open. {matrix.people.length} active
          people · {matrix.departments.length} departments · {overrides} override
          {overrides === 1 ? "" : "s"} in place.
        </p>
      </header>

      <AccessManager matrix={matrix} />
    </div>
  );
}
