import { redirect } from "next/navigation";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { RecycleBin } from "@/components/tasks/recycle-bin";
import { listAbandonedTasks } from "@/app/(app)/tasks/lifecycle-actions";
import { requireUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * Abandoned tasks, restorable. Admin-only, matching `abandonTask` itself —
 * the query already returns nothing for a non-admin, so the redirect is about
 * not showing an empty page that looks like a bug.
 */
export default async function RecycleBinPage() {
  const me = await requireUser();
  if (!me.isAdmin) redirect("/tasks");

  const rows = await listAbandonedTasks();

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="w-full">
        <RecycleBin rows={rows} />
      </main>
      <DashboardFooter />
    </>
  );
}
