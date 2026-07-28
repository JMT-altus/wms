"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Inbox } from "lucide-react";
import { NewTaskForm } from "./new-task-form";
import type { TaskPriority } from "@/db/enums";

/**
 * The "New Task-like panel" that opens when you click an UNASSIGNED (pool)
 * task. It's the New Task form in complete-mode, pre-filled from the task, so
 * Mihir fills in the client / subject / due / description he skipped at
 * quick-dump time and (optionally) assigns a doer. Driven by a `?complete=<id>`
 * search param — closing strips the param and returns to the list/board.
 */
export function CompleteTaskModal({
  taskId,
  defaults,
  employees,
  clients,
  subjects,
  projectNodes,
}: {
  taskId: string;
  defaults: {
    title?: string;
    taskTitle?: string;
    initiatorId?: string;
    doerId?: string;
    priority?: TaskPriority;
    subject?: string;
    description?: string;
    dueAt?: string;
  };
  employees: { id: string; name: string }[];
  clients: string[];
  subjects: string[];
  projectNodes?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function close() {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("complete");
    const qs = sp.toString();
    router.push((qs ? `${pathname}?${qs}` : pathname) as Route);
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[min(1360px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{ maxHeight: "calc(100vh - 48px)" }}
        >
          <div
            className="relative px-10 py-7 max-md:px-5 max-md:py-5"
            style={{
              borderBottom: "1px solid var(--color-hairline)",
              background: "linear-gradient(135deg, #ffffff 0%, #FFFBEB 100%)",
            }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0"
              style={{ height: 5, background: "linear-gradient(90deg, var(--color-amber), var(--color-tangerine))" }}
            />
            <Dialog.Title
              className="text-ink-strong inline-flex items-center gap-2.5"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 900,
                fontSize: "clamp(30px, 3.2vw, 46px)",
                letterSpacing: "-0.02em",
                lineHeight: 1.02,
              }}
            >
              <Inbox size={30} strokeWidth={2.4} style={{ color: "var(--color-amber-deep)" }} />
              Complete task
            </Dialog.Title>
            <Dialog.Description className="mt-2 font-bold" style={{ fontSize: 18, color: "var(--color-ink-muted)" }}>
              Fill in the details you skipped — set the client, subject, due date, and assign a doer (or leave it for later).
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="absolute top-6 right-6 inline-flex items-center justify-center rounded-full transition-all hover:bg-surface-soft"
                style={{ width: 48, height: 48, border: "1px solid var(--color-hairline)", background: "#ffffff", color: "var(--color-ink-muted)" }}
              >
                <X size={24} strokeWidth={2.4} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-10 py-8 max-md:px-5 max-md:py-5" style={{ maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}>
            <NewTaskForm
              employees={employees}
              clients={clients}
              subjects={subjects}
              projectNodes={projectNodes}
              completeTaskId={taskId}
              onCompleted={close}
              defaults={defaults}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
