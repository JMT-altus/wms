import { listEmployees } from "@/lib/queries/employees";
import { listActiveClientNames } from "@/lib/queries/clients";
import { listActiveSubjectNames } from "@/lib/queries/subjects";
import { listProjectNodeOptions } from "@/lib/queries/projects";
import { listActiveDepartments } from "@/lib/queries/departments";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canQuickDump } from "@/lib/auth/quick-dump";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";

export async function NewTaskTrigger() {
  const me = await getCurrentEmployee();
  if (!me) return null;
  const [all, clients, subjects, projectNodes, departmentRows] = await Promise.all([
    listEmployees(),
    listActiveClientNames(),
    listActiveSubjectNames(),
    listProjectNodeOptions(),
    listActiveDepartments(),
  ]);
  const options = all.map((e) => ({ id: e.id, name: e.name }));
  const departments = departmentRows.map((d) => ({ id: d.id, name: d.name }));
  return (
    <NewTaskDialog
      employees={options}
      clients={clients}
      subjects={subjects}
      projectNodes={projectNodes}
      departments={departments}
      defaultInitiatorId={me.id}
      isAdmin={me.isAdmin}
      canQuickDump={canQuickDump(me.email)}
    />
  );
}
