import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current";
import { getPlanViewer } from "@/lib/plan/actor";
import { listPlanTree } from "@/lib/queries/plan";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveSubjectNames } from "@/lib/queries/subjects";
import { listActiveDepartments } from "@/lib/queries/departments";
import type { RegisterLevel } from "@/lib/plan/register";
import { PlanWorkspace } from "@/components/plan/plan-workspace";

/**
 * ONE page component, parameterised by level.
 *
 * Five page files would be five places to add the next column to. Each route
 * is a three-line file that names its level and defers to this.
 *
 * Every plan screen reads the SAME `listPlanTree()` — no screen owns a copy of
 * anything, which is what stops a row reporting one status in the register and
 * another on the board.
 */
export async function PlanPage({
  level,
  initialView,
}: {
  level: RegisterLevel;
  initialView?: "register" | "tree" | "kanban";
}) {
  const me = await requireUser();
  const [tree, viewer, employees, clients, subjects, departments] = await Promise.all([
    listPlanTree(),
    getPlanViewer(me),
    listEmployeeOptions(),
    listActiveClientNames(),
    listActiveSubjectNames(),
    listActiveDepartments(),
  ]);

  return (
    <Suspense>
      <PlanWorkspace
        tree={tree}
        viewer={viewer}
        level={level}
        initialView={initialView}
        employees={employees.map((e) => ({ id: e.id, name: e.name }))}
        roster={employees.map((e) => ({ id: e.id, name: e.name }))}
        clients={clients}
        subjects={subjects}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
      />
    </Suspense>
  );
}
