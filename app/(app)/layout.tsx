import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/current";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { IdleTimerClient } from "@/components/auth/idle-timer-client";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { BrandHero } from "@/components/dashboard/brand-hero";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
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
