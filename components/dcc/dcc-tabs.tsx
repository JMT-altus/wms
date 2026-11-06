import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { LayoutDashboard, Trophy } from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";

export interface DccTabPerson {
  id: string;
  name: string;
  designation: string | null;
  department: string | null;
}

export interface DccTabsProps {
  /** Everyone whose checklist the viewer may open, in roster order. Always includes the viewer. */
  people: DccTabPerson[];
  meId: string;
  /** An employee id, "dashboard" or "ranking". */
  active: string;
  /** The Dashboard tab is for people who can see more than themselves. */
  showDashboard: boolean;
  /** Query string carried onto each employee tab, e.g. "view=grid&week=2026-11-02". */
  query?: string;
}

/**
 * The sheet tabs: one per employee (name, with designation and department
 * underneath, as the workbook's sheet names carried a person each), then
 * Dashboard and Ranking. Server-rendered links — the active tab is whatever
 * the page is showing, no client state to drift.
 *
 * The roster comes from the DCC scope, never from a list in code: a new
 * employee gets a tab the moment they are active and visible.
 */
export function DccTabs({ people, meId, active, showDashboard, query }: DccTabsProps) {
  const suffix = query ? `&${query}` : "";
  return (
    <nav aria-label="Checklists" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max items-stretch gap-1 border-b border-hairline">
        {people.map((p) => (
          <li key={p.id}>
            <Tab
              href={`/dcc?emp=${p.id}${suffix}`}
              active={active === p.id}
              label={p.id === meId ? `${p.name} (me)` : p.name}
              sub={[p.designation, p.department].filter(Boolean).join(" · ") || null}
              lead={<EmployeeAvatar name={p.name} size="sm" />}
            />
          </li>
        ))}
        {showDashboard && (
          <li>
            <Tab href="/dcc/dashboard" active={active === "dashboard"} label="Dashboard" sub="Team compliance" lead={<LayoutDashboard size={16} />} />
          </li>
        )}
        <li>
          <Tab href="/dcc/ranking" active={active === "ranking"} label="Ranking" sub="30-day leaderboard" lead={<Trophy size={16} />} />
        </li>
      </ul>
    </nav>
  );
}

function Tab({ href, active, label, sub, lead }: { href: string; active: boolean; label: string; sub: string | null; lead: ReactNode }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      // The full name and role on hover, for chips where they are truncated.
      title={sub ? `${label} — ${sub}` : label}
      className={`flex h-full items-center gap-2.5 rounded-t-[10px] border-b-2 px-3 py-2 transition ${
        active ? "border-altus-red bg-surface-card text-ink-strong" : "border-transparent text-ink-muted hover:bg-surface-soft hover:text-ink-strong"
      }`}
    >
      <span className="grid size-7 shrink-0 place-items-center text-ink-subtle">{lead}</span>
      <span className="min-w-0 text-left">
        <span className="block max-w-[180px] truncate text-[13px] font-bold leading-tight">{label}</span>
        {sub && <span className="block max-w-[180px] truncate text-[11px] leading-tight text-ink-subtle">{sub}</span>}
      </span>
    </Link>
  );
}
