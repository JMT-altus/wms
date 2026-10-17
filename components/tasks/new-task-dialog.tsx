"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Plus, X, Upload, Zap } from "lucide-react";
import { NewTaskForm } from "./new-task-form";
import { TaskImport } from "./task-import";
import { QuickDumpDialog } from "./quick-dump-dialog";
import type { ProjectNodeOption } from "@/lib/queries/projects";

interface Props {
  employees: { id: string; name: string }[];
  /** Client roster for the "Client Name" picker. */
  clients: string[];
  /** Subject roster for the "Subject" picker. */
  subjects: string[];
  /** Project tree nodes for the optional Project link. */
  projectNodes?: ProjectNodeOption[];
  /** Audience options for the visibility picker. */
  departments?: { id: string; name: string }[];
  /** Optional defaults — usually pre-fill initiator = current user. */
  defaultInitiatorId?: string;
  /** Admins get the "Import" shortcut in the dialog header. */
  isAdmin?: boolean;
  /** Allowlisted users (Mihir Veera / Altus Corp) get the "Quick Dump" shortcut. */
  canQuickDump?: boolean;
}

const HINT_STORAGE_KEY = "vp_seen_new_task_hint";

export function NewTaskDialog({ employees, clients, subjects, projectNodes, departments, defaultInitiatorId, isAdmin, canQuickDump }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Open the Import popup instead of navigating to a page (the page round-trip
  // hit the remote DB and felt slow). Close New Task first so the two dialogs
  // never stack.
  function goImport() {
    setOpen(false);
    setImportOpen(true);
  }

  // Quick Dump — same pattern: close New Task, open the rapid-capture dialog.
  function goQuickDump() {
    setOpen(false);
    setQuickOpen(true);
  }

  // First-time hint: surface if the user has never seen it before.
  // Dismisses on dialog open, on explicit close, or after 10s.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(HINT_STORAGE_KEY);
      if (!seen) {
        // Delay a beat so the entry animation reads cleanly before the hint pops.
        const t = window.setTimeout(() => setShowHint(true), 700);
        return () => window.clearTimeout(t);
      }
    } catch {
      // localStorage may be unavailable — silently skip the hint.
    }
  }, []);

  const dismissHint = useCallback(() => {
    if (!showHint) return;
    setShowHint(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, [showHint]);

  // Auto-dismiss after 10s.
  useEffect(() => {
    if (!showHint) return;
    const t = window.setTimeout(dismissHint, 10000);
    return () => window.clearTimeout(t);
  }, [showHint, dismissHint]);

  // Keyboard shortcut: pressing "N" (no modifier) opens the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Ignore when typing in form fields.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) dismissHint();
  }

  function onSuccess(taskId: string) {
    setOpen(false);
    dismissHint();
    router.push(`/tasks/${taskId}` as Route);
  }

  return (
    <>
    {/* Header "Import" shortcut (admins) — the same Import tasks popup the New Task
        dialog opens, one click closer. Sits before the "+", as in the reference. */}
    {isAdmin && (
      <button
        type="button"
        onClick={goImport}
        title="Import tasks"
        aria-label="Import tasks"
        className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#0A6CFF]/50 max-md:hidden"
        style={{
          background: "var(--chrome-ctl-bg, rgba(255,255,255,0.08))",
          border: "1.5px solid var(--chrome-ctl-border, rgba(255,255,255,0.16))",
          color: "var(--chrome-ctl-fg, rgba(255,255,255,0.88))",
        }}
      >
        <Upload size={15} strokeWidth={2.4} />
      </button>
    )}
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <div className="relative">
        <Tooltip.Provider delayDuration={600}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Dialog.Trigger asChild>
                {/* The plus, with the key that does the same thing printed on
                    its corner.

                    The N badge used to live in the tooltip, which meant the
                    shortcut was only discoverable by hovering for most of a
                    second — so nobody found it, and the fastest way into this
                    dialog went unused. Printing the key on the button is how
                    a shortcut gets learned.

                    Carries the app's brand gradient (the same blue → teal as
                    the header hairline and .audit-filter-chip-active), not the
                    alert red it used to wear — creating a task is the header's
                    primary action, not a warning. */}
                <button
                  type="button"
                  aria-label="New task (shortcut: N)"
                  aria-keyshortcuts="N"
                  className="group relative inline-flex size-8 items-center justify-center rounded-lg text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  style={{
                    background:
                      "linear-gradient(135deg, #0A6CFF 0%, #0A6CFF 42%, #17B6A0 100%)",
                    boxShadow:
                      "0 4px 12px rgba(10, 108, 255, 0.40), inset 0 0 0 1px rgba(255,255,255,0.20)",
                    transition:
                      "transform 180ms ease, box-shadow 220ms ease, filter 180ms ease",
                    animation:
                      "newTaskIn 420ms cubic-bezier(0.16, 1, 0.3, 1) both",
                    willChange: "transform",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.06)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 22px rgba(10, 108, 255, 0.55), 0 0 0 5px rgba(10, 108, 255, 0.14), inset 0 0 0 1px rgba(255,255,255,0.30)";
                    e.currentTarget.style.filter = "brightness(1.06)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(10, 108, 255, 0.40), inset 0 0 0 1px rgba(255,255,255,0.20)";
                    e.currentTarget.style.filter = "";
                  }}
                >
                  <Plus size={17} strokeWidth={2.8} />
                  {/* The shortcut key, pinned to the button's top-right corner
                      rather than stacked under the plus — the button keeps its
                      32px square and the header band its spacing, and the
                      badge reads as a label ON the button instead of a second
                      row inside it.

                      Header navy, not another translucent white: over a blue →
                      teal gradient a white-on-white chip goes soft, and this
                      has to read as a key you can press. */}
                  <span
                    aria-hidden
                    className="absolute grid place-items-center rounded-[4px] font-bold"
                    style={{
                      top: -5,
                      right: -5,
                      width: 14,
                      height: 13,
                      fontSize: 9,
                      lineHeight: 1,
                      color: "#ffffff",
                      background: "#0F172A",
                      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.45)",
                    }}
                  >
                    N
                  </span>
                </button>
              </Dialog.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={10}
                className="z-[80] rounded-md px-3 py-2 text-[13px] shadow-lg"
                style={{
                  background: "#0F172A",
                  color: "#ffffff",
                  animation: "userMenuIn 140ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                Create a new task <span style={{ opacity: 0.7 }}>· press N</span>
                <Tooltip.Arrow style={{ fill: "#0F172A" }} />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>

        {showHint && (
          <button
            type="button"
            onClick={dismissHint}
            aria-label="Dismiss hint"
            className="absolute right-0 top-full mt-3 z-40 text-left"
            style={{
              minWidth: 240,
              maxWidth: 280,
              padding: "10px 12px",
              borderRadius: 12,
              background:
                "linear-gradient(135deg, #ffffff 0%, #F0FBFF 100%)",
              color: "#0F172A",
              boxShadow:
                "0 18px 36px -10px rgba(10, 108, 255, 0.38), 0 4px 12px rgba(15, 23, 42, 0.10)",
              border: "1px solid rgba(10, 108, 255, 0.22)",
              animation:
                "hintBalloonIn 360ms cubic-bezier(0.16, 1, 0.3, 1) both",
              fontSize: 14,
              lineHeight: 1.45,
              cursor: "pointer",
            }}
          >
            {/* Balloon arrow */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -6,
                right: 22,
                width: 12,
                height: 12,
                background:
                  "linear-gradient(135deg, #ffffff 0%, #F0FBFF 100%)",
                borderTop: "1px solid rgba(10, 108, 255, 0.22)",
                borderLeft: "1px solid rgba(10, 108, 255, 0.22)",
                transform: "rotate(45deg)",
              }}
            />
            <span className="block font-semibold" style={{ color: "#0F172A" }}>
              Start by creating your first task
              <span style={{ color: "rgb(0, 66, 138)" }}> →</span>
            </span>
            <span
              className="block mt-0.5"
              style={{ color: "#64748B", fontSize: 13 }}
            >
              Click here or press <kbd
                style={{
                  display: "inline-block",
                  padding: "0 4px",
                  borderRadius: 3,
                  background: "rgba(15, 23, 42, 0.08)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                N
              </kbd> to begin.
            </span>
          </button>
        )}
      </div>

      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[min(1040px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{ maxHeight: "calc(100vh - 32px)" }}
        >
          {/* Header — cyan brand bar + title */}
          <div
            className="relative px-6 py-4 max-md:px-4 max-md:py-3"
            style={{
              borderBottom: "1px solid var(--color-hairline)",
              background:
                "linear-gradient(135deg, #ffffff 0%, #F0FBFF 100%)",
            }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0"
              style={{
                height: 3,
                background:
                  "linear-gradient(90deg, rgb(2, 99, 204), rgb(0, 66, 138))",
              }}
            />
            <Dialog.Title
              className="text-ink-strong"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 800,
                fontSize: "clamp(20px, 2vw, 26px)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              New Task
            </Dialog.Title>
            <Dialog.Description
              className="mt-1 font-medium"
              style={{
                fontSize: 13,
                color: "var(--color-ink-muted)",
              }}
            >
              Capture work, attach context, assign owners — all in one go.
            </Dialog.Description>
            {/* Top-right actions — Quick Dump (allowlist) + Import (admin) + Close. */}
            <div className="absolute top-3 right-4 flex items-center gap-2">
              {canQuickDump && (
                <button
                  type="button"
                  onClick={goQuickDump}
                  title="Dump tasks fast, unassigned — assign them later"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D3E2FB] bg-[#EEF4FF] px-3 h-8 text-[13px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD] hover:border-[#B8CCEE] active:bg-[#D6E4FB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF] max-md:px-2.5"
                >
                  <Zap size={14} strokeWidth={2.4} />
                  <span className="max-md:hidden">Quick Dump</span>
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={goImport}
                  title="Bulk-import tasks from CSV or Excel"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 h-8 text-[13px] font-semibold text-[#334155] transition-colors hover:bg-[#F5F8FE] hover:border-[#B8CCEE] active:bg-[#EAF0FB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF] max-md:px-2.5"
                >
                  <Upload size={14} strokeWidth={2.2} className="text-[#0A6CFF]" />
                  <span className="max-md:hidden">Import</span>
                </button>
              )}
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="inline-flex items-center justify-center rounded-full transition-all"
                  style={{
                    width: 32,
                    height: 32,
                    border: "1px solid var(--color-hairline)",
                    background: "#ffffff",
                    color: "var(--color-ink-muted)",
                  }}
                >
                  <X size={16} strokeWidth={2.4} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Scrollable body — fills the rectangle */}
          <div
            className="px-6 py-4 max-md:px-4 max-md:py-3"
            style={{
              maxHeight: "calc(100vh - 130px)",
              overflowY: "auto",
            }}
          >
            <NewTaskForm
              isAdmin={Boolean(isAdmin)}
              employees={employees}
              clients={clients}
              subjects={subjects}
              projectNodes={projectNodes}
              departments={departments}
              onSuccess={onSuccess}
              defaults={{ initiatorId: defaultInitiatorId }}
              compact
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    {/* Quick Dump popup (allowlist) — controlled; opened from the header shortcut. */}
    {canQuickDump && (
      <QuickDumpDialog open={quickOpen} onOpenChange={setQuickOpen} renderTrigger={false} />
    )}

    {/* Import popup (admin) — opens in place instead of navigating to a page. */}
    {isAdmin && (
      <Dialog.Root open={importOpen} onOpenChange={setImportOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="fixed inset-0 z-[60]"
            style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
          />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[70] w-[min(920px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-surface-card shadow-xl overflow-hidden"
            style={{ maxHeight: "calc(100vh - 32px)" }}
          >
            <div
              className="relative px-5 py-3 max-md:px-4"
              style={{
                borderBottom: "1px solid var(--color-hairline)",
                background: "#ffffff",
              }}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0"
                style={{ height: 3, background: "linear-gradient(90deg, rgb(2, 99, 204), rgb(0, 66, 138))" }}
              />
              <Dialog.Title
                className="text-ink-strong inline-flex items-center gap-2.5"
                style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", lineHeight: 1.1 }}
              >
                <Upload size={18} strokeWidth={2.4} style={{ color: "var(--color-altus-red)" }} />
                Import tasks
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute top-2.5 right-4 inline-flex items-center justify-center rounded-full transition-all hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
                  style={{ width: 32, height: 32, border: "1px solid var(--color-hairline)", background: "#ffffff", color: "var(--color-ink-muted)" }}
                >
                  <X size={16} strokeWidth={2.4} />
                </button>
              </Dialog.Close>
            </div>
            <div className="px-5 py-4 max-md:px-4" style={{ maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>
              <TaskImport embedded onSuccess={() => setImportOpen(false)} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )}
    </>
  );
}
