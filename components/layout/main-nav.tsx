"use client";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, ListTodo, CalendarDays, FolderKanban, SquareKanban, Target,
  CalendarCheck, CalendarRange, Award, IndianRupee, Receipt, CalendarOff,
  Contact, Sparkles, GraduationCap, LayoutGrid,
} from "lucide-react";
import type { Route } from "next";
import { MainNavPill } from "./main-nav-pill";
import { moduleForPath, type ModuleNavItem } from "@/lib/nav-modules";

interface Props {
  activeTasks: number;
  isAdmin: boolean;
  variant?: "drawer";
}

const ICONS: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard, ListTodo, CalendarDays, FolderKanban, SquareKanban, Target,
  CalendarCheck, CalendarRange, Award, IndianRupee, Receipt, CalendarOff,
  Contact, Sparkles, GraduationCap, LayoutGrid,
};

export function MainNav({ activeTasks, isAdmin, variant }: Props) {
  const pathname = usePathname();
  const activeModule = moduleForPath(pathname);

  function isActive(item: ModuleNavItem): boolean {
    if (item.href === "/") return pathname === "/";
    if (!pathname.startsWith(item.href)) return false;
    if (item.notMatch?.some((n) => pathname.startsWith(n))) return false;
    return true;
  }

  const items = activeModule.items.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav
      aria-label="Primary"
      className={
        variant === "drawer"
          ? "flex flex-col gap-1.5 w-full"
          : "flex items-center gap-1 2xl:gap-1.5 max-md:gap-1"
      }
    >
      {/* Back to Hub — returns to the workspace launcher. */}
      <MainNavPill
        href={"/hub" as Route}
        label="Back to Hub"
        Icon={LayoutGrid}
        active={false}
        variant={variant}
      />
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        return (
          <MainNavPill
            key={item.href}
            href={item.href as Route}
            label={item.label}
            Icon={Icon}
            active={isActive(item)}
            count={item.taskCount ? activeTasks : undefined}
            variant={variant}
          />
        );
      })}
    </nav>
  );
}
