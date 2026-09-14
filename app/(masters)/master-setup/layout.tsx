import type { CSSProperties, ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/current";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { MasterSidebar } from "@/components/admin/master/master-sidebar";
import { MastersAccentScope } from "@/components/masters/accent-scope";
import { DashboardHeader } from "@/components/layout/header";

/**
 * Master Setup's own shell — a sibling of the Admin Panel, not a section of it.
 * Same `requireAdmin` gate, its own sidebar and accent.
 */
/** The amber ramp this module is known by. Declared once and used twice: on
 *  the wrapper below (so the page paints it server-side, with no flash) and on
 *  the document root (so portalled dialogs get it too). */
const ACCENT = "linear-gradient(135deg, #f59e0b 0%, #f59e0b 42%, #b45309 100%)";
const ACCENT_BAR = "linear-gradient(90deg, #f59e0b 0%, #b45309 100%)";
const ACCENT_INK = "#b45309";

export default async function MasterSetupLayout({ children }: { children: ReactNode }) {
  const me = await requireAdmin();
  const settings = await getOrgSettings();

  return (
    <>
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <MastersAccentScope accent={ACCENT} accentBar={ACCENT_BAR} ink={ACCENT_INK} />
      {/* The amber this module is known by, handed to every Masters component
          rendered inside it (see components/masters/theme.ts). The sidebar
          paints the same ramp, so the rail and the page's buttons agree. */}
      <div
        className="min-h-screen flex max-md:block"
        style={
          {
            "--masters-accent": ACCENT,
            "--masters-accent-bar": ACCENT_BAR,
            "--masters-ink": ACCENT_INK,
          } as CSSProperties
        }
      >
        <MasterSidebar adminName={me.name} />
        <div className="flex-1 min-w-0 max-md:flex max-md:flex-col">
        {/* The app's slim header bar, same as every other module, so search /
            Live / account are reachable here too. */}
        <DashboardHeader generatedAt={new Date()} />
          <main className="flex-1 min-w-0 px-10 py-10 max-md:px-4 max-md:py-6">
            <div className="mx-auto max-w-[1280px]">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
