"use client";

import * as React from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { refFor } from "@/lib/plan/levels";
import { LEVEL_KIND, buildRegisterRows, type RegisterLevel } from "@/lib/plan/register";
import { countPlan, type PlanSort } from "@/lib/plan/table";
import type { PlanViewer } from "@/lib/plan/viewer";
import type { PlanNode } from "@/lib/queries/plan";
import { PlanCreate } from "./plan-create";
import { PlanToolbar, type PlanChip } from "./plan-toolbar";
import { PlanControls } from "./plan-controls";
import { PlanKanban } from "./plan-kanban";
import { PlanRegisterTable } from "./plan-register-table";
import { PlanTreeTable } from "./plan-tree-table";
import { usePlanBranch } from "./use-plan-branch";


/**
 * FIVE SIDEBAR ITEMS, ONE PAGE COMPONENT, parameterised by `level`.
 *
 * Five page files would be five places to add the next column to. The level
 * lives in the URL, not in component state — that is what lets the sidebar and
 * the browser Back button agree, and it makes "the results view" a link
 * someone can send. Level navigation belongs to the sidebar alone; a second
 * row of level pills here could only drift from it.
 *
 * The view (register / tree / kanban) is a `?view=` param for the same reason.
 */

type ViewMode = "register" | "tree" | "kanban";

/**
 * The view a plan route opens on when the URL says nothing.
 *
 * ONE constant, read by both the parse and the write. They were two literals
 * that had drifted apart — the reader defaulted to `tree` while the writer
 * still assumed `register`, so choosing Table view deleted the `?view=` param
 * as "already the default" and the reader then resolved the absent param back
 * to the hierarchy. The button worked; the round-trip undid it.
 */
const DEFAULT_VIEW: ViewMode = "tree";

interface Props {
  tree: PlanNode[];
  viewer: PlanViewer;
  level: RegisterLevel;
  /** The board route opens straight onto the kanban. */
  initialView?: ViewMode;
  employees: { id: string; name: string }[];
  roster: { id: string; name: string; email?: string | null }[];
  clients: string[];
  subjects: string[];
  departments: { id: string; name: string }[];
}

export function PlanWorkspace({
  tree,
  viewer,
  level,
  initialView,
  employees,
  roster,
  clients,
  subjects,
  departments,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const viewParam = params.get("view");
  const view: ViewMode =
    viewParam === "tree" || viewParam === "kanban" || viewParam === "register"
      ? viewParam
      : (initialView ?? DEFAULT_VIEW);

  const [query, setQuery] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<PlanSort>("plan");

  const [chip, setChip] = React.useState<PlanChip>(null);
  const [maxDepth, setMaxDepth] = React.useState<number | null>(null);
  const [fullScreen, setFullScreen] = React.useState(false);

  // Counted over the WHOLE tree — see PlanToolbar.
  const counts = React.useMemo(() => countPlan(tree), [tree]);

  const { branch, remember } = usePlanBranch(tree);
  /** The count beside the create row — the rows this level actually has. */
  const rowCount = React.useMemo(
    () => buildRegisterRows(projectId ? tree.filter((n) => n.id === projectId) : tree, level).length,
    [tree, level, projectId],
  );
  const projects = React.useMemo(
    () => tree.filter((n) => n.kind === "project"),
    [tree],
  );
  const projectOptions = React.useMemo(
    () =>
      projects.map((p, i) => ({
        id: p.id,
        name: p.name,
        ref: refFor("project", i + 1),
      })),
    [projects],
  );

  /** The controls band speaks in List / Kanban / Table view. */
  function switchView(next: "list" | "kanban" | "table") {
    setView(next === "list" ? "tree" : next === "table" ? "register" : "kanban");
  }

  function setView(next: ViewMode) {
    const sp = new URLSearchParams(params.toString());
    // The default view is an ABSENT key, not "?view=register" — a URL should
    // not carry a parameter that says "do the usual thing".
    if (next === (initialView ?? DEFAULT_VIEW)) sp.delete("view");
    else sp.set("view", next);
    const qs = sp.toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  }

  /** Remember the branch whenever the project filter moves. */
  function pickProject(id: string | null) {
    setProjectId(id);
    if (!id) return;
    const project = projects.find((p) => p.id === id);
    if (project) {
      remember([{ id: project.id, kind: "project", name: project.name }]);
    }
  }

  return (
    <div className="min-w-0">
      <PlanToolbar
        level={level}
        counts={counts}
        chip={chip}
        onChip={setChip}
        onFullScreen={() => setFullScreen(true)}
      />

      {/* Search and the create row. Kept above the controls band because they
          ADD rows or find one; everything in the band below only narrows what
          is already there. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative flex-1 min-w-[260px]">
          <Search
            size={14}
            strokeWidth={2.4}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--color-ink-subtle)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Local search — projects, milestones, results, actions"
            aria-label="Search the plan"
            className="w-full rounded-lg pl-9 pr-3 h-10 text-[14px] outline-none focus:ring-1"
            style={{
              background: "var(--color-surface-card)",
              border: "1px solid var(--color-hairline-strong)",
              color: "var(--color-ink)",
            }}
          />
        </label>

        <PlanCreate
          tree={tree}
          branch={branch}
          employees={employees}
          roster={roster}
          clients={clients}
          subjects={subjects}
          departments={departments}
          defaultInitiatorId={viewer.id}
          isAdmin={viewer.isAdmin}
          onDone={() => router.refresh()}
        />
      </div>

      {/*
        The controls band lives HERE for Kanban and Table view, and inside the
        hierarchy table for List — because only List has columns, rows and an
        export to wire into it. Rendering it in the table alone stranded you:
        switching away took the view switcher with it, and there was no way
        back.
      */}
      {view !== "tree" && (
        <PlanControls
          view={view === "kanban" ? "kanban" : "table"}
          onView={switchView}
          projectId={projectId}
          onProject={pickProject}
          projects={projectOptions}
          maxDepth={maxDepth}
          onMaxDepth={setMaxDepth}
          sort={sort}
          onSort={setSort}
          onNew={() => setView("tree")}
          newLabel="New project"
        />
      )}

      {/* ── The surface ───────────────────────────────────────────────── */}
      {view === "tree" && (
        <PlanTreeTable
          tree={tree}
          viewer={viewer}
          employees={employees}
          query={query}
          projectId={projectId}
          onProjectChange={pickProject}
          projects={projectOptions}
          sort={sort}
          onSortChange={setSort}
          chip={chip}
          maxDepth={maxDepth}
          onMaxDepthChange={setMaxDepth}
          fullScreen={fullScreen}
          onFullScreenChange={setFullScreen}
          onView={switchView}
        />
      )}
      {view === "register" && (
        <PlanRegisterTable
          tree={tree}
          level={level}
          viewer={viewer}
          query={query}
          projectId={projectId}
          chip={chip}
          employees={employees}
        />
      )}
      {view === "kanban" && (
        <PlanKanban tree={tree} viewer={viewer} query={query} projectId={projectId} chip={chip} />
      )}
    </div>
  );
}
