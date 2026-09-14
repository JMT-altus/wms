import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current";
import { getPlanViewer } from "@/lib/plan/actor";
import { listPlanTree } from "@/lib/queries/plan";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { PlanViews } from "@/components/plan/plan-views";

export const dynamic = "force-dynamic";

/**
 * Project Views — first in the sidebar, because it is the only item that
 * answers "what is in this plan?" without a click.
 *
 * Reads the SAME `listPlanTree()` every other plan screen reads. The viewer
 * comes from ONE roster lookup so the status picker on every row can render
 * what it allows without a round-trip each; the server still re-resolves the
 * actor on every write.
 *
 * The employee list is for the edit dialog the Task column opens — scheduling
 * a row is giving it an owner, and the picker needs the roster to offer.
 */
export default async function Page() {
  const me = await requireUser();
  const [tree, viewer, employees] = await Promise.all([
    listPlanTree(),
    getPlanViewer(me),
    listEmployeeOptions(),
  ]);
  return (
    <Suspense>
      <PlanViews
        tree={tree}
        viewer={viewer}
        employees={employees.map((e) => ({ id: e.id, name: e.name }))}
      />
    </Suspense>
  );
}
