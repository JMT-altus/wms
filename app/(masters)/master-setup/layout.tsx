import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/current";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { MasterSidebar } from "@/components/admin/master/master-sidebar";

/**
 * Master Setup's own shell — a sibling of the Admin Panel, not a section of it.
 * Same `requireAdmin` gate, its own sidebar and accent.
 */
export default async function MasterSetupLayout({ children }: { children: ReactNode }) {
  const me = await requireAdmin();
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block">
        <MasterSidebar adminName={me.name} />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
          <main className="flex-1 min-w-0 px-10 py-10 max-md:px-4 max-md:py-6">
            <div className="mx-auto max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
