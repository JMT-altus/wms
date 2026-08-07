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
    tagline: "The work dashboard for tasks, goals & the daily loop.",
    icon: "LayoutGrid",
    landing: "/",
    routes: ["/tasks", "/projects", "/weekly-goals", "/inbox", "/archived", "/search", "/documents", "/forms"],
    accent: { from: "#0A6CFF", to: "#0047B3", ink: "#0A6CFF" },
    items: [
      { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/tasks/agenda", label: "My Day", icon: "CalendarDays" },
      { href: "/tasks", label: "Tasks", icon: "ListTodo", taskCount: true, notMatch: ["/tasks/agenda", "/tasks/kanban"] },
      { href: "/tasks/kanban", label: "Kanban", icon: "SquareKanban" },
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
    routes: ["/attendance", "/salary", "/reimbursements", "/leave-approval"],
    accent: { from: "#12B3A0", to: "#0C7C6F", ink: "#0C7C6F" },
    items: [
      { href: "/attendance", label: "Attendance", icon: "CalendarCheck", notMatch: ["/attendance/dashboard"] },
      { href: "/attendance/dashboard", label: "Att Report", icon: "CalendarRange", adminOnly: true },
      { href: "/salary", label: "Salary", icon: "IndianRupee", adminOnly: true },
      { href: "/reimbursements", label: "Reimbursements", icon: "Receipt" },
      { href: "/leave-approval", label: "Leave Approval", icon: "CalendarOff" },
    ],
  },
  {
    id: "sales",
    label: "Incentive Tracker",
    tagline: "Log your sales, track your incentive.",
    icon: "TrendingUp",
    landing: "/incentive",
    routes: ["/incentive", "/outstanding", "/record-reference", "/participant-breakthrough"],
    accent: { from: "#6366F1", to: "#3F3FB0", ink: "#4F46E5" },
    items: [
      { href: "/incentive", label: "My Incentives", icon: "Award", notMatch: ["/incentive/sales", "/incentive/activity", "/incentive/history", "/incentive/admin"] },
      { href: "/incentive/sales", label: "My Sales", icon: "IndianRupee" },
      { href: "/incentive/activity", label: "Activity", icon: "Sparkles" },
      { href: "/incentive/history", label: "History", icon: "CalendarRange" },
      { href: "/incentive/admin", label: "Team", icon: "Users", adminOnly: true },
      { href: "/outstanding", label: "Outstanding", icon: "Contact" },
    ],
  },
  {
    id: "training",
    label: "Training",
    tagline: "Material library, sessions, self-learning & feedback.",
    icon: "GraduationCap",
    landing: "/training",
    routes: ["/training"],
    accent: { from: "#0EA5B7", to: "#0B7C8A", ink: "#0B7C8A" },
    items: [
      // `notMatch` lists every sibling so the Library pill (which sits at the
      // module root) doesn't stay lit on all of them — same pattern as Tasks.
      {
        href: "/training",
        label: "Library",
        icon: "GraduationCap",
        notMatch: [
          "/training/calendar",
          "/training/self-learning",
          "/training/share",
          "/training/obligations",
          "/training/induction",
          "/training/feedback",
          "/training/dashboard",
          "/training/settings",
        ],
      },
      { href: "/training/calendar", label: "Calendar", icon: "CalendarDays" },
      { href: "/training/self-learning", label: "Self-Learning", icon: "BookOpen" },
      { href: "/training/share", label: "Share", icon: "Share2" },
      { href: "/training/obligations", label: "Obligations", icon: "Gauge" },
      { href: "/training/induction", label: "Induction", icon: "ListChecks" },
      { href: "/training/feedback", label: "Feedback", icon: "MessageSquare" },
      { href: "/training/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/training/settings", label: "Settings", icon: "Settings", adminOnly: true },
    ],
  },
];

export const MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

/**
 * Like `moduleForPath` but honest about misses: returns null for routes that
 * belong to no module (/hub, /profile, /admin/*) instead of silently falling
 * back to WMS.  The access guard uses this — a fallback would mean denying WMS
 * also denied the hub itself, which redirects to the hub, which loops.
 */
export function moduleIdForPath(pathname: string): ModuleId | null {
  if (pathname === "/") return "wms";
  let best: ModuleId | null = null;
  let bestLen = 0;
  for (const m of MODULES) {
    for (const r of [m.landing, ...m.routes]) {
      if (r === "/") continue;
      if ((pathname === r || pathname.startsWith(r + "/")) && r.length > bestLen) {
        best = m.id;
        bestLen = r.length;
      }
    }
  }
  return best;
}

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
