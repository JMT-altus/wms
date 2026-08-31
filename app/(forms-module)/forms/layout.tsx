import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/current";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { FormsSidebar, FormsMobileNav } from "@/components/forms/forms-sidebar";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The Forms module's shell — a mirror of the Masters one.
 *
 * Its own route group, not a section of `(app)`, for the same reason Masters
 * has one: this module navigates from its own left rail rather than `(app)`'s.
 * It renders the same slim DashboardHeader as everywhere else.
 *
 * That also means `(app)`'s module-access guard doesn't cover these routes —
 * hence the explicit `requireAdmin` here. It has to be explicit either way:
 * `moduleIdForPath("/forms/...")` resolves to WMS, which is granted to
 * everyone by default, so inheriting that guard would have widened access
 * rather than restricted it.
 */
export default async function FormsLayout({ children }: { children: ReactNode }) {
  const me = await requireAdmin();
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <FormsSidebar userName={me.name} />
        <FormsMobileNav />
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
