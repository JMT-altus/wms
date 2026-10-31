import type { ReactNode } from "react";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { getCollectionCapabilities } from "@/lib/auth/capability";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { CollectionSidebar, CollectionMobileNav } from "@/components/collections/collection-sidebar";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The Collection module's shell — its own route group with its own left rail,
 * like Masters, Targets and Project Plan.
 *
 * Being outside `(app)` means that group's module-access guard doesn't cover
 * these routes, hence the explicit `requireModuleAccess("collection")` here:
 * the one place every /collection page passes through. Someone without the
 * module is sent back to the hub with the usual "no access" notice. The
 * module opens the door only — which sections appear in the rail, and what
 * every page and action then allows, is decided by the collection.* Field
 * Permissions exactly as it was when these pages lived under Forms.
 */
export default async function CollectionLayout({ children }: { children: ReactNode }) {
  const me = await requireModuleAccess("collection");
  const settings = await getOrgSettings();
  // Only decides which nav links show; every Collection page and action checks again.
  const caps = await getCollectionCapabilities();
  const showCommitments = caps["collection.commitments.view"] || caps["collection.escalation.review"];
  const showCollection = caps["collection.view"];
  const showLogs = caps["collection.logs.view"];

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <div className="min-h-screen flex max-md:block app-wallpaper">
        <CollectionSidebar userName={me.name} showCommitments={showCommitments} showCollection={showCollection} showLogs={showLogs} />
        <CollectionMobileNav showCommitments={showCommitments} showCollection={showCollection} showLogs={showLogs} />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
          {/* The app's slim header bar, same as every other module carries. */}
          <DashboardHeader generatedAt={new Date()} />
          <main className="flex-1 min-w-0 px-6 pt-5 pb-6 max-md:px-4 max-md:py-4">
            <div className="mx-auto max-w-[1600px] min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
