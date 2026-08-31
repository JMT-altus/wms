import type { ReactNode } from "react";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { TargetsSidebar, TargetsMobileNav } from "@/components/targets/targets-sidebar";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The Targets & Forecasts shell.
 *
 * Its own route group with a left rail, so it can't share `(app)`'s top-pill
 * chrome — which also means `(app)`'s single module-access guard doesn't cover
 * it. Hence the explicit `requireModuleAccess` here: the one place every
 * /targets page passes through.
 */
export default async function TargetsLayout({ children }: { children: ReactNode }) {
  const me = await requireModuleAccess("targets");
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <TargetsSidebar userName={me.name} />
        <TargetsMobileNav />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
          {/* The app's slim header bar, same as every (app) page carries, so
              the search / Live / account cluster is reachable from every
              module instead of only the workspace one. */}
          <DashboardHeader generatedAt={new Date()} />
          <main className="flex-1 min-w-0 px-8 pt-6 pb-8 max-md:px-4 max-md:py-4">
            <div className="mx-auto max-w-[1440px] min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
