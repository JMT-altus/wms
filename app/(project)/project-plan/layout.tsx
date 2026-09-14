import type { ReactNode } from "react";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { PlanSidebar, PlanMobileNav } from "@/components/plan/plan-sidebar";
import { DashboardHeader } from "@/components/layout/header";
import { PLAN_MAX_WIDTH } from "@/components/plan/theme";

/**
 * The Project Plan module's shell.
 *
 * Its own route group, not a section of `(app)`: this module navigates from a
 * left rail rather than the top pill row, so it can't share `(app)`'s chrome.
 * That also means `(app)`'s single module-access guard doesn't cover it —
 * hence the explicit `requireModuleAccess` here, which is the one place every
 * /project-plan page passes through. Same pattern as the Masters module.
 */
export default async function ProjectPlanLayout({ children }: { children: ReactNode }) {
  const me = await requireModuleAccess("project");
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <PlanSidebar userName={me.name} />
        <PlanMobileNav />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
          {/* The app's slim header bar, same as every other module carries, so
              the search / account cluster is reachable from here too. */}
          <DashboardHeader generatedAt={new Date()} />
          <main className="flex-1 min-w-0 px-6 pt-5 pb-6 max-md:px-4 max-md:py-4">
            <div className="mx-auto min-w-0" style={{ maxWidth: PLAN_MAX_WIDTH }}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
