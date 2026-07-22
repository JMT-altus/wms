/**
 * The workspace hub is organised into four modules. Each module owns a set of
 * routes; the primary nav shows only the current module's items plus a
 * "Back to Hub" affordance. The hub landing (/hub) renders one tile per module.
 *
 * Icons are referenced by lucide name and resolved in the components that render
 * them (kept as strings here so this file stays server/client neutral).
 */

export type ModuleId = "wms" | "employees" | "sales" | "training";

export interface ModuleNavItem {
  href: string;
  label: string;
  icon: string; // lucide-react icon name
  adminOnly?: boolean;
  /** When true, the pill shows the live active-task count. */
  taskCount?: boolean;
  /** Extra path prefixes that also belong to this item (for active-state). */
  match?: string[];
  /** Paths that must NOT match (so sibling routes don't both highlight). */
  notMatch?: string[];
}

export interface ModuleDef {
  id: ModuleId;
  label: string;
  tagline: string;
  icon: string;
  /** Landing route the hub tile opens. */
  landing: string;
  /** Route prefixes that belong to this module (for detecting the active one). */
  routes: string[];
  /** Tile gradient (from, to) + accent used on the hub card. */
  accent: { from: string; to: string; ink: string };
  items: ModuleNavItem[];
}

export const MODULES: ModuleDef[] = [
  {
    id: "wms",
    label: "WMS",
    tagline: "The work dashboard — tasks, goals & the daily loop.",
    icon: "LayoutGrid",
    landing: "/",
    routes: ["/tasks", "/projects", "/weekly-goals", "/inbox", "/archived", "/search", "/documents", "/forms"],
    accent: { from: "#0A6CFF", to: "#0047B3", ink: "#0A6CFF" },
    items: [
      { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/tasks/agenda", label: "My Day", icon: "CalendarDays" },
      { href: "/tasks", label: "Tasks", icon: "ListTodo", taskCount: true, notMatch: ["/tasks/agenda", "/tasks/kanban"] },
      { href: "/tasks/kanban", label: "Kanban", icon: "SquareKanban", adminOnly: true },
      { href: "/projects", label: "Projects", icon: "FolderKanban" },
      { href: "/weekly-goals", label: "Weekly Goals", icon: "Target" },
    ],
  },
  {
    id: "employees",
    label: "Employees",
    tagline: "Attendance, leave, salary & the team roster.",
    icon: "Users",
    landing: "/attendance",
    routes: ["/attendance", "/salary", "/incentive", "/reimbursements", "/leave-approval"],
    accent: { from: "#12B3A0", to: "#0C7C6F", ink: "#0C7C6F" },
    items: [
      { href: "/attendance", label: "Attendance", icon: "CalendarCheck", notMatch: ["/attendance/dashboard"] },
      { href: "/attendance/dashboard", label: "Att Report", icon: "CalendarRange", adminOnly: true },
      { href: "/salary", label: "Salary", icon: "IndianRupee", adminOnly: true },
      { href: "/incentive", label: "Incentive", icon: "Award" },
      { href: "/reimbursements", label: "Reimbursements", icon: "Receipt" },
      { href: "/leave-approval", label: "Leave Approval", icon: "CalendarOff" },
    ],
  },
  {
    id: "sales",
    label: "Incentive Tracker",
    tagline: "Collections, references & breakthroughs.",
    icon: "TrendingUp",
    landing: "/outstanding",
    routes: ["/outstanding", "/record-reference", "/participant-breakthrough"],
    accent: { from: "#6366F1", to: "#3F3FB0", ink: "#4F46E5" },
    items: [
      { href: "/outstanding", label: "Outstanding", icon: "IndianRupee" },
      { href: "/record-reference", label: "Record Reference", icon: "Contact" },
      { href: "/participant-breakthrough", label: "Participant Breakthrough", icon: "Sparkles" },
    ],
  },
  {
    id: "training",
    label: "Training",
    tagline: "Material library, tests, induction & feedback.",
    icon: "GraduationCap",
    landing: "/training",
    routes: ["/training"],
    accent: { from: "#0EA5B7", to: "#0B7C8A", ink: "#0B7C8A" },
    items: [
      { href: "/training", label: "Library", icon: "GraduationCap" },
    ],
  },
];

/** Resolve which module a pathname belongs to (defaults to WMS). */
export function moduleForPath(pathname: string): ModuleDef {
  // Longest matching route prefix wins so /attendance/dashboard maps to
  // employees, not WMS's "/" fallback.
  let best: ModuleDef = MODULES[0]!;
  let bestLen = -1;
  for (const m of MODULES) {
    for (const r of [m.landing, ...m.routes]) {
      if (r === "/") continue;
      if ((pathname === r || pathname.startsWith(r + "/") || pathname.startsWith(r)) && r.length > bestLen) {
        best = m;
        bestLen = r.length;
      }
    }
  }
  // Exact dashboard root is WMS.
  if (pathname === "/") return MODULES[0]!;
  return best;
}
