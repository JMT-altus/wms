"use client";

import * as React from "react";
import { Link2, Paperclip, Trash2, Upload, X, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  deletePlanAttachment,
  listPlanAttachments,
  uploadPlanAttachment,
  type PlanAttachment,
} from "@/app/(project)/project-plan/attachment-actions";
import { updatePlanNode } from "@/app/(project)/project-plan/actions";
import { PLAN_RED, PLAN_RED_SOFT, TABULAR } from "./theme";

/**
 * The attachments and links cells.
 *
 * The two sit side by side in every register and must have the SAME shape and
 * the SAME behaviour — two cells that look identical and answer to different
 * gestures would be worse than either choice on its own. So they are one
 * component with one difference: where the list comes from.
 *
 *   attachments  a signed URL per file, fetched on open
 *   links        a few lines of text that already rode down with the row, so
 *                there is nothing to fetch
 *
 * A count and nothing else until opened. A row with something is RED, so a
 * column of sixty rows says at a glance which ones carry anything.
 */

/**
 * Erring slightly large on purpose: guessing too big merely drops a panel that
 * would have fitted above, guessing too small opens one off the top of the
 * window.
 */
const PANEL_MAX_H = 320;
const PANEL_W = 280;

/**
 * The right-hand edge the panel has to stay inside.
 *
 * The nearest ancestor that scrolls or clips horizontally — the plan table's
 * own scroller on every screen this cell appears on. Walked rather than
 * hard-coded because the same cell is used by Project Views, the hierarchy
 * table and the registers, and each wraps it in its own container; the window
 * is the fallback when nothing clips.
 */
function clipEdge(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflowX = getComputedStyle(node).overflowX;
    if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
      return node.getBoundingClientRect().right;
    }
    node = node.parentElement;
  }
  return window.innerWidth;
}

type Mode = "attachments" | "links";

interface Props {
  nodeId: string;
  mode: Mode;
  /** Attachments: the count that rode down with the row. Links: unused. */
  count?: number;
  /** Links: the list itself, already on the row. */
  links?: string[] | null;
  onDone?: () => void;
}

export function PlanPanelCell({ nodeId, mode, count = 0, links, onDone }: Props) {
  const isLinks = mode === "links";
  const [open, setOpen] = React.useState(false);
  /** Clicking pins the panel so it does not evaporate while you reach for a
   *  filename; hovering alone lets it close. */
  const [pinned, setPinned] = React.useState(false);
  const [above, setAbove] = React.useState(false);
  const [files, setFiles] = React.useState<PlanAttachment[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Adopt fresh server values DURING RENDER (compare against the last props we
  // saw), so the cell never sticks on a stale local list after a revalidate.
  const serverLinks = React.useMemo(() => links ?? [], [links]);
  const [lastLinks, setLastLinks] = React.useState(serverLinks);
  const [localLinks, setLocalLinks] = React.useState(serverLinks);
  if (serverLinks !== lastLinks) {
    setLastLinks(serverLinks);
    setLocalLinks(serverLinks);
  }
  const [alignRight, setAlignRight] = React.useState(false);
  const [lastCount, setLastCount] = React.useState(count);
  if (count !== lastCount) {
    setLastCount(count);
    setFiles(null); // refetch on next open rather than show a stale list
  }

  const total = isLinks ? localLinks.length : (files?.length ?? count);
  const carries = total > 0;

  const openPanel = React.useCallback(() => {
    const anchor = anchorRef.current;
    const rect = anchor?.getBoundingClientRect();
    if (rect && anchor) {
      const below = window.innerHeight - rect.bottom;
      setAbove(below < PANEL_MAX_H && rect.top > below);
      // Files is the second-to-last column, so opening rightwards from it put
      // most of the panel past the edge of the table's scroller, which clips
      // it — half a panel with the button you wanted in the missing half.
      setAlignRight(rect.left + PANEL_W + 8 > clipEdge(anchor));
    }
    setOpen(true);
    if (!isLinks && files === null && !loading) {
      setLoading(true);
      void listPlanAttachments(nodeId)
        .then((res) => setFiles(res.ok ? res.files : []))
        .finally(() => setLoading(false));
    }
  }, [isLinks, files, loading, nodeId]);

  React.useEffect(() => {
    if (!pinned) return;
    function onAway(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  /**
   * Close on scroll, whether the panel was hovered open or pinned.
   *
   * It is positioned against its own cell, so the moment the table scrolls
   * underneath it the two part company and it hangs over the page pointing at
   * nothing. Capture phase, because the scroll happens on the table's
   * container rather than on the window.
   */
  React.useEffect(() => {
    if (!open) return;
    // Only when something OUTSIDE the panel scrolled: the file list scrolls
    // inside its own 320px box, and a bare capture listener would close the
    // panel the moment you reached for the item at the bottom of it.
    function close(e: Event) {
      const target = e.target;
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      setPinned(false);
      setOpen(false);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function upload(file: File) {
    const form = new FormData();
    form.set("nodeId", nodeId);
    form.set("file", file);
    startTransition(async () => {
      const res = await uploadPlanAttachment(form);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const fresh = await listPlanAttachments(nodeId);
      if (fresh.ok) setFiles(fresh.files);
      onDone?.();
    });
  }

  function removeFile(id: string) {
    startTransition(async () => {
      const res = await deletePlanAttachment(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setFiles((prev) => prev?.filter((f) => f.id !== id) ?? null);
      onDone?.();
    });
  }

  function saveLinks(next: string[]) {
    const previous = localLinks;
    setLocalLinks(next);
    startTransition(async () => {
      const res = await updatePlanNode({ id: nodeId, links: next });
      if (!res.ok) {
        toast.error(res.error);
        setLocalLinks(previous);
        return;
      }
      onDone?.();
    });
  }

  const Icon = isLinks ? Link2 : Paperclip;

  return (
    <div
      ref={anchorRef}
      className="relative inline-block"
      // Opens on hover — point at the cell and the list appears, no click
      // needed to find out what is in there.
      onMouseEnter={openPanel}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => {
          setPinned(true);
          openPanel();
        }}
        className="inline-flex items-center gap-1 rounded-md px-1.5 h-[20px]"
        aria-label={`${total} ${isLinks ? "links" : "attachments"}`}
        style={{
          color: carries ? PLAN_RED : "var(--color-ink-subtle)",
          background: carries ? `color-mix(in srgb, ${PLAN_RED_SOFT} 55%, transparent)` : "transparent",
        }}
      >
        <Icon size={12} strokeWidth={2.4} />
        <span style={{ ...TABULAR, fontSize: 13, fontWeight: carries ? 700 : 400 }}>
          {total}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute z-50 rounded-xl shadow-lg overflow-hidden"
          style={{
            [above ? "bottom" : "top"]: "calc(100% + 4px)",
            // Anchored to whichever edge keeps it on the table.
            ...(alignRight ? { right: 0 } : { left: 0 }),
            width: PANEL_W,
            maxHeight: PANEL_MAX_H,
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid var(--color-hairline)" }}
          >
            <span className="text-[12.5px] font-bold" style={{ color: "var(--color-ink)" }}>
              {isLinks ? "Links" : "Attachments"}
            </span>
            {pinned && (
              <button
                type="button"
                onClick={() => {
                  setPinned(false);
                  setOpen(false);
                }}
                aria-label="Close"
                style={{ color: "var(--color-ink-subtle)" }}
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            )}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: PANEL_MAX_H - 84 }}>
            {isLinks ? (
              <LinkList links={localLinks} onSave={saveLinks} disabled={pending} />
            ) : loading ? (
              <p className="px-3 py-3 text-[12.5px]" style={{ color: "var(--color-ink-subtle)" }}>
                Loading…
              </p>
            ) : (files?.length ?? 0) === 0 ? (
              <p className="px-3 py-3 text-[12.5px]" style={{ color: "var(--color-ink-subtle)" }}>
                Nothing attached yet.
              </p>
            ) : (
              files!.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 group">
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 truncate text-[12.5px] hover:underline"
                      style={{ color: PLAN_RED }}
                      title={f.fileName}
                    >
                      {f.fileName}
                    </a>
                  ) : (
                    <span
                      className="flex-1 min-w-0 truncate text-[12.5px]"
                      style={{ color: "var(--color-ink-subtle)" }}
                      title="The link could not be generated — try again in a moment."
                    >
                      {f.fileName}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    disabled={pending}
                    aria-label={`Remove ${f.fileName}`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    style={{ color: "var(--color-ink-subtle)" }}
                  >
                    <Trash2 size={12} strokeWidth={2.4} />
                  </button>
                </div>
              ))
            )}
          </div>

          {!isLinks && (
            <div className="px-3 py-2" style={{ borderTop: "1px solid var(--color-hairline)" }}>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                  // The picker closing is exactly when the pointer wanders off
                  // and takes the panel — and the upload — with it.
                  setPinned(true);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  // Pin BEFORE the OS picker opens, for the same reason.
                  setPinned(true);
                  fileRef.current?.click();
                }}
                disabled={pending}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg h-7 text-[12.5px] font-semibold"
                style={{ background: PLAN_RED, color: "#fff" }}
              >
                <Upload size={12} strokeWidth={2.6} />
                {pending ? "Working…" : "Add a file"}
              </button>
              <p className="mt-1 text-[11px]" style={{ color: "var(--color-ink-subtle)" }}>
                Up to 20 MB. Links expire after 10 minutes.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Links are a COLUMN, not a marker in the notes prose.
 *
 * Rendering a Links cell from free text means parsing on every row, and a note
 * containing "Links:" sprouts links nobody added. The server validates
 * `^https?://` before it stores anything, so an href here can never carry
 * `javascript:`.
 */
function LinkList({
  links,
  onSave,
  disabled,
}: {
  links: string[];
  onSave: (next: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = React.useState("");

  function add() {
    const url = draft.trim();
    if (url === "") return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("A link has to start with http:// or https://");
      return;
    }
    onSave([...links, url]);
    setDraft("");
  }

  return (
    <>
      {links.length === 0 && (
        <p className="px-3 py-3 text-[12.5px]" style={{ color: "var(--color-ink-subtle)" }}>
          No links yet.
        </p>
      )}
      {links.map((url, i) => (
        <div key={`${url}-${i}`} className="flex items-center gap-2 px-3 py-1.5 group">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0 truncate text-[12.5px] hover:underline"
            style={{ color: PLAN_RED }}
            title={url}
          >
            {url.replace(/^https?:\/\//i, "")}
          </a>
          <button
            type="button"
            onClick={() => onSave(links.filter((_, j) => j !== i))}
            disabled={disabled}
            aria-label={`Remove ${url}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            style={{ color: "var(--color-ink-subtle)" }}
          >
            <Trash2 size={12} strokeWidth={2.4} />
          </button>
        </div>
      ))}
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ borderTop: "1px solid var(--color-hairline)" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="https://…"
          disabled={disabled}
          className="flex-1 min-w-0 rounded-lg px-2 h-7 text-[12.5px] outline-none focus:ring-1"
          style={{
            background: "transparent",
            border: "1px solid var(--color-hairline-strong)",
            color: "var(--color-ink)",
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          aria-label="Add link"
          className="shrink-0 grid place-items-center rounded-lg size-7"
          style={{ background: PLAN_RED, color: "#fff" }}
        >
          <Plus size={13} strokeWidth={2.8} />
        </button>
      </div>
    </>
  );
}
