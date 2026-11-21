import { redirect } from "next/navigation";
import type { Route } from "next";

/** Incentive Tracker → Incentive Management opens on its Overview. */
export default function IncentiveManagementPage() {
  redirect("/incentive/manage/overview" as Route);
}
