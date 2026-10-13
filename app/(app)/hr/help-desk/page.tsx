import { DashboardHeader } from "@/components/layout/header";
import { HelpDeskPanel } from "@/components/hr/help-desk-panel";
import { requireUser } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

/**
 * HR Help Desk — layout and the ticket form only. There is no ticket model,
 * table or action in the project yet, so nothing is read or saved here and the
 * list is always the empty state. Access is the HR module's own (/hr prefix).
 */
export default async function HrHelpDeskPage() {
  await requireUser();

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: "#F7F6F3" }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-6 pb-10 max-md:pb-8">
          <HelpDeskPanel />
        </main>
      </div>
    </>
  );
}
