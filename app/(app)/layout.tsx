import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireUser } from "@/lib/auth/current";
import { getMyModuleAccess } from "@/lib/auth/module-access";
import { moduleIdForPath } from "@/lib/nav-modules";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { BrandHero } from "@/components/dashboard/brand-hero";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();

  // Single enforcement point for module access. `x-pathname` is stamped by
  // middleware.ts on every authenticated request (RSC navigations included),
  // so this one check covers every page in the group — no per-route guard to
  // forget. If the header is missing, or the path belongs to no module
  // (/hub, /profile), we fail open: a missing header must not lock the whole
  // app out. Export route handlers aren't wrapped by layouts and guard
  // themselves via canAccessModule().
  const pathname = (await headers()).get("x-pathname");
  const moduleId = pathname ? moduleIdForPath(pathname) : null;
  if (moduleId) {
    const access = await getMyModuleAccess();
    if (!access[moduleId]?.allowed) redirect(`/hub?denied=${moduleId}` as Route);
  }

  const settings = await getOrgSettings();
  return (
    <div className="app-wallpaper">
      <IdleTimerClient timeoutMinutes={settings.idleTimeoutMinutes} />
      <KeyboardShortcuts />
      {/* Brand header band on every app page. Self-hides on /hub + focus mode. */}
      <BrandHero companyName="JMT DRIVE SOLUTIONS" />
      {children}
    </div>
  );
}
