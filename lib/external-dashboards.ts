import type { Employee } from "@/db/schema";

export type DashboardAccent = "blue" | "amber" | "purple";
export type DashboardIconName = "Building2" | "Receipt" | "TrendingUp";

export interface DashboardLink {
  id: "leads" | "liasoning" | "mandate-collection";
  label: string;
  description: string;
  url: string;
  accent: DashboardAccent;
  iconName: DashboardIconName;
  visibleTo: (e: Employee) => boolean;
}

// Lowercased once, matched against the also-lowercased employee email.
// Extra non-admin employees who should still see the external dashboards.
// Empty by default for JMT Drive Solutions — add addresses here if needed.
const SPECIAL_EMAILS = new Set<string>([]);

function isSpecialOrAdmin(e: Employee): boolean {
  if (e.isAdmin) return true;
  const email = e.email.trim().toLowerCase();
  return SPECIAL_EMAILS.has(email);
}

// No external dashboards configured for JMT Drive Solutions. The Altus-specific
// Google Apps Script dashboards were removed during rebrand. Add JMT's own
// external links here following the DashboardLink shape when available.
export const EXTERNAL_DASHBOARDS: readonly DashboardLink[] = [];

/**
 * Serializable shape forwarded from server → client (drops the predicate function).
 */
export interface VisibleDashboard {
  id: DashboardLink["id"];
  label: string;
  description: string;
  url: string;
  accent: DashboardAccent;
  iconName: DashboardIconName;
}

export function getVisibleDashboards(employee: Employee | null): VisibleDashboard[] {
  if (!employee) return [];
  return EXTERNAL_DASHBOARDS.filter((d) => d.visibleTo(employee)).map(
    ({ id, label, description, url, accent, iconName }) => ({
      id,
      label,
      description,
      url,
      accent,
      iconName,
    }),
  );
}
