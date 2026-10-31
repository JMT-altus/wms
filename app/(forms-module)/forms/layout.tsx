import type { ReactNode } from "react";
import { requireModuleAccess } from "@/lib/auth/module-access";
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
 * hence the explicit `requireModuleAccess("forms")` here, the one place every
 * Forms page passes through. Set in Admin → Access like any other module.
 *
 * Collection used to live here too; it is now its own module at /collection
 * (app/(collection-module)), with its own rail and module access. Customer
 * Master and Tally Data Import moved the other way, from Admin & Master Setup
 * into this module, alongside the Forms sections that show what Tally Data
 * Import writes (Vendor Master, the document ledgers, Outstanding Balances).
 * The module gate is the whole of what viewing needs; those two pages add
 * their own admin check, and importing its own sensitive permission.
 */
export default async function FormsLayout({ children }: { children: ReactNode }) {
  const me = await requireModuleAccess("forms");
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <FormsSidebar userName={me.name} isAdmin={me.isAdmin} />
        <FormsMobileNav isAdmin={me.isAdmin} />
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
