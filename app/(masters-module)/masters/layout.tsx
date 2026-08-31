import type { ReactNode } from "react";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { MastersSidebar, MastersMobileNav } from "@/components/masters/masters-sidebar";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The Masters module's shell.
 *
 * Its own route group, not a section of `(app)`: this module navigates from a
 * left rail rather than the top pill row, so it can't share `(app)`'s chrome.
 * That also means `(app)`'s single module-access guard doesn't cover it — hence
 * the explicit `requireModuleAccess` here, which is the one place every
 * /masters page passes through.
 */
export default async function MastersLayout({ children }: { children: ReactNode }) {
  const me = await requireModuleAccess("masters");
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <MastersSidebar userName={me.name} />
        <MastersMobileNav />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
          {/* The app's slim header bar, same as every (app) page carries, so
              the search / Live / account cluster is reachable from every
              module instead of only the workspace one. */}
          <DashboardHeader generatedAt={new Date()} />
          <main className="flex-1 min-w-0 px-6 pt-5 pb-6 max-md:px-4 max-md:py-4">
            <div className="mx-auto max-w-[1600px] min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
