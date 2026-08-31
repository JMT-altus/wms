"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { TaskAttachment } from "@/lib/queries/task-attachments";
import {
  attachFileToTask,
  attachLinkToTask,
  getAttachmentUrl,
  removeTaskAttachment,
} from "@/app/(app)/tasks/attachment-actions";

const MAX_MB = 25;

function iconFor(a: TaskAttachment) {
  if (a.linkUrl) return Link2;
  if (a.mimeType?.startsWith("image/")) return ImageIcon;
  return FileText;
}

function sizeLabel(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "drive.google.com" from a full URL, so a link row shows where it points. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/**
 * Files and links attached to a task.
 *
 * Anyone who can see the task can add to it — that is the whole point: when a
 * doer sets a task to "Need info", the person with the answer has to be able to
 * put the document here. Removing is narrower: whoever attached it, or an admin.
 */
export function TaskAttachments({
  taskId,
  attachments,
  meId,
  isAdmin,
  canAttach,
}: {
  taskId: string;
  attachments: TaskAttachment[];
  meId: string | null;
  isAdmin: boolean;
  canAttach: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkTitle, setLinkTitle] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");
  const [pending, start] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`That file is over ${MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("file", file);
    const res = await attachFileToTask(fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok) toast.success("Attached.");
    else toast.error(res.error);
  }

  function addLink(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await attachLinkToTask({ taskId, title: linkTitle, url: linkUrl });
      if (res.ok) {
        toast.success("Link attached.");
        setLinkTitle("");
        setLinkUrl("");
        setLinkOpen(false);
      } else toast.error(res.error);
    });
  }

  async function open(a: TaskAttachment) {
    if (a.linkUrl) {
      window.open(a.linkUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const res = await getAttachmentUrl(a.id);
    if (res.ok && res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    else if (!res.ok) toast.error(res.error);
  }

  function remove(a: TaskAttachment) {
    if (!confirm(`Remove "${a.title}"?`)) return;
    start(async () => {
      const res = await removeTaskAttachment(a.id);
      if (res.ok) toast.success("Removed.");
      else toast.error(res.error);
    });
  }

  return (
    <section
      className="rounded-section border border-hairline bg-surface-card px-5 py-4"
      style={{ boxShadow: "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2
          className="inline-flex items-center gap-2 uppercase font-bold tracking-[0.08em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          <Paperclip size={13} strokeWidth={2.4} />
          Attachments
          {attachments.length > 0 && (
            <span className="text-ink-muted tabular-nums">· {attachments.length}</span>
          )}
        </h2>
        {busy && <Loader2 size={14} className="animate-spin text-ink-subtle" />}
      </div>

      {attachments.length === 0 && (
        <p className="text-ink-muted mb-3" style={{ fontSize: 13 }}>
          Nothing attached yet.
          {canAttach && " Add a file or paste a Drive link."}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="grid gap-1.5 mb-3">
          {attachments.map((a) => {
            const Icon = iconFor(a);
            const mine = meId !== null && a.uploadedById === meId;
            return (
              <li
                key={a.id}
                className="group flex items-center gap-2.5 rounded-chip px-2.5 py-2"
                style={{ background: "var(--color-surface-soft)" }}
              >
                <Icon size={15} strokeWidth={2.2} className="shrink-0 text-ink-muted" />
                <button
                  type="button"
                  onClick={() => open(a)}
                  className="min-w-0 flex-1 text-left"
                  title={a.linkUrl ?? a.title}
                >
                  <span className="block truncate font-semibold text-ink-strong" style={{ fontSize: 13 }}>
                    {a.title}
                  </span>
                  <span className="block truncate text-ink-subtle" style={{ fontSize: 11.5 }}>
                    {a.linkUrl ? hostOf(a.linkUrl) : sizeLabel(a.sizeBytes)}
                    {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
                  </span>
                </button>
                {a.linkUrl && (
                  <ExternalLink size={13} strokeWidth={2.2} className="shrink-0 text-ink-subtle" />
                )}
                {(mine || isAdmin) && (
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    disabled={pending}
                    aria-label={`Remove ${a.title}`}
                    title="Remove"
                    className="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    style={{ color: "var(--color-red-deep)" }}
                  >
                    <Trash2 size={14} strokeWidth={2.3} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAttach && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft bg-surface-card border border-hairline disabled:opacity-50"
            >
              <Upload size={13} strokeWidth={2.4} />
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft bg-surface-card border border-hairline"
            >
              <Link2 size={13} strokeWidth={2.4} />
              Add link
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </div>

          {linkOpen && (
            <form onSubmit={addLink} className="mt-3 grid gap-2">
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="What is it? e.g. Costing sheet"
                maxLength={200}
                required
                className="rounded-chip px-3 h-9 bg-surface-soft border border-hairline outline-none text-[13.5px] text-ink-strong"
              />
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
                maxLength={2000}
                required
                inputMode="url"
                className="rounded-chip px-3 h-9 bg-surface-soft border border-hairline outline-none text-[13.5px] text-ink-strong"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-chip px-3 h-8 text-[12.5px] font-bold text-white disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}
                >
                  {pending ? "Saving…" : "Add link"}
                </button>
                <button
                  type="button"
                  onClick={() => setLinkOpen(false)}
                  className="rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft border border-hairline"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <p className="mt-2 text-ink-subtle" style={{ fontSize: 11.5 }}>
            PDFs, images and Office files up to {MAX_MB} MB. Anyone who can see this task can attach.
          </p>
        </>
      )}
    </section>
  );
}
