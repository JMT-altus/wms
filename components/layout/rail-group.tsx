"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ModuleNavItem } from "@/lib/nav-modules";

/** The number printed beside a child: its own `num` if set, else its position. */
const numberFor = (c: ModuleNavItem, i: number): string | null =>
  c.num === undefined ? String(i + 1) : c.num;

/**
 * An expandable group in the module rail: a header row that folds its numbered
 * children. Open by default whenever the current page is inside it, so the
 * active child is never hidden. Collapsed, the rail shows the icon only and
 * opens the first child.
 */
export function RailGroup({
  item,
  Icon,
  pathname,
  accent,
  collapsed,
  light = false,
}: {
  item: ModuleNavItem;
  Icon: LucideIcon;
  pathname: string;
  accent: string;
  collapsed: boolean;
  /** White rail: dark text on white, blue active row. */
  light?: boolean;
}) {
  const children = item.children ?? [];
  const inside = pathname === item.href || pathname.startsWith(`${item.href}/`);
  // null = follow the route (open while the current page is inside the group);
  // a boolean = the user folded or unfolded it by hand.
  const [manual, setManual] = React.useState<boolean | null>(null);
  const [wasInside, setWasInside] = React.useState(inside);
  // Arriving inside the group from elsewhere (a link, back/forward) drops a
  // manual fold so the active section is never hidden.
  if (inside !== wasInside) {
    setWasInside(inside);
    if (inside) setManual(null);
  }
  const open = manual ?? inside;

  if (collapsed) {
    return (
      <Link
        href={(children[0]?.href ?? item.href) as Route}
        title={item.label}
        aria-current={inside ? "page" : undefined}
        className="relative flex items-center justify-center py-2 rounded-lg"
        style={
          light
            ? inside ? { background: "#0A6CFF", color: "#fff" } : { color: "#334155" }
            : inside ? { background: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "rgba(255,255,255,0.80)" }
        }
      >
        <Icon size={16} strokeWidth={2.2} />
      </Link>
    );
  }

  const panelId = `rail-group-${item.href.replace(/\W+/g, "-")}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManual(!open)}
        className={`group relative flex w-full items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
          light ? "hover:bg-[#EEF4FF]" : "hover:bg-white/[0.06]"
        }`}
        style={{ color: light ? (inside ? "#0B4FB8" : "#334155") : inside ? "#fff" : "rgba(255,255,255,0.80)" }}
      >
        <Icon
          size={16}
          strokeWidth={2.2}
          className="shrink-0"
          style={{ color: light ? (inside ? "#0A6CFF" : "#64748b") : "rgba(255,255,255,0.65)" }}
        />
        <span className="flex-1 min-w-0 text-[13.5px] font-medium truncate">{item.label}</span>
        <ChevronDown
          size={14}
          strokeWidth={2.4}
          aria-hidden
          className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <ol
          id={panelId}
          className="mt-0.5 ml-[18px] flex flex-col gap-0.5 pl-2"
          style={{ borderLeft: light ? "1px solid #E2E8F0" : "1px solid rgba(255,255,255,0.12)" }}
        >
          {children.map((c, i) => {
            const active = pathname === c.href || pathname.startsWith(`${c.href}/`);
            return (
              <li key={c.href}>
                <Link
                  href={c.href as Route}
                  aria-current={active ? "page" : undefined}
                  title={c.label}
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px] leading-snug transition-colors ${
                    light ? "hover:bg-[#EEF4FF]" : "hover:bg-white/[0.06]"
                  }`}
                  style={
                    light
                      ? active ? { background: "#0A6CFF", color: "#fff" } : { color: "#475569" }
                      : active ? { background: "rgba(255,255,255,0.12)", color: "#fff" } : { color: "rgba(255,255,255,0.78)" }
                  }
                >
                  {numberFor(c, i) !== null && (
                    <span className="shrink-0 tabular-nums min-w-4 text-right" style={{ opacity: 0.7 }}>
                      {numberFor(c, i)}.
                    </span>
                  )}
                  <span className="min-w-0">{c.label}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
