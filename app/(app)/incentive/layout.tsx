import type { ReactNode } from "react";
import { DashboardHeader } from "@/components/layout/header";

/**
 * The Incentive Tracker shares the WMS chrome — the sticky navy pill-nav
 * (Back to Hub · My Incentives · My Sales · Activity · History · Team) renders
 * on every /incentive route, so navigation matches the rest of the app.
 */
export default function IncentiveLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      {children}
    </>
  );
}
