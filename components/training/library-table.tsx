"use client";
import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Eye,
  ExternalLink,
  FileText,
  Film,
  GraduationCap,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { MaterialRow } from "@/lib/queries/training";
import {
  TRAINING_MATERIAL_KINDS,
  TRAINING_MATERIAL_KIND_LABELS,
  type TrainingMaterialKind,
} from "@/db/enums";
import {
  createMaterial,
  deleteMaterial,
  setMaterialArchived,
  setWatched,
} from "@/app/(app)/training/actions";
import { Tag, TRAINING_ACCENT, TRAINING_ACCENT_SOFT } from "./ui";

const KIND_ICON: Record<TrainingMaterialKind, typeof Film> = {
  video_link: Film,
  document: FileText,
  pdf: FileText,
  slide: FileText,
  other: FileText,
};

export function LibraryTable({
  rows,
  subjects,
  canCurate,
}: {
  rows: MaterialRow[];
  subjects: string[];
  /** Admin/MD — may add, archive and delete. Everyone else reads + watches. */
  canCurate: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [inductionOnly, setInductionOnly] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (inductionOnly && !r.isInduction) return false;
      if (subject && (r.subject ?? "") !== subject) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        (r.subject ?? "").toLowerCase().includes(needle) ||
        (r.createdByName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, subject, inductionOnly]);

  const inductionCount = rows.filter((r) => r.isInduction).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(okMsg);
      else toast.error(res.error ?? "That didn't work.");
    });
  }

  return (
    <>
      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <div
          className="inline-flex items-center gap-2 rounded-pill px-4 h-11 bg-surface-card border border-hairline"
          style={{ minWidth: 300 }}
        >
          <Search size={17} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search materials…"
            className="bg-transparent outline-none text-[15px] w-full text-ink-strong"
          />
        </div>

        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="rounded-pill px-4 h-11 bg-surface-card border border-hairline text-[15px] font-semibold text-ink-soft outline-none"
        >
          <option value="">All Subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setInductionOnly((v) => !v)}
          aria-pressed={inductionOnly}
          className="inline-flex items-center gap-2 rounded-pill px-4 h-11 text-[15px] font-semibold transition-colors"
          style={
            inductionOnly
              ? {
                  background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
                  color: "#fff",
                  border: "1px solid transparent",
                }
              : {
                  background: "var(--color-surface-card)",
                  color: "var(--color-ink-soft)",
                  border: "1px solid var(--color-hairline)",
                }
          }
        >
          <GraduationCap size={16} strokeWidth={2.2} />
          Induction · {inductionCount}
        </button>

        <span className="ml-auto text-[14px] font-semibold text-ink-muted tabular-nums">
          {filtered.length} {filtered.length === 1 ? "material" : "materials"}
        </span>
      </div>

      {canCurate && (
        <div className="mb-4">
          {adding ? (
            <AddMaterialForm
              subjects={subjects}
              onClose={() => setAdding(false)}
              onDone={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white font-bold transition-transform hover:-translate-y-0.5"
              style={{
                background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
                fontSize: 15,
                boxShadow: "0 10px 22px -10px rgba(11,124,138,0.6)",
              }}
            >
              <Plus size={17} strokeWidth={2.6} />
              Add Material
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 900 }}>
            <thead>
              <tr
                className="text-left uppercase tracking-[0.08em] text-ink-subtle"
                style={{ fontSize: 11.5, fontWeight: 700 }}
              >
                <th className="px-5 py-3.5">Added</th>
                <th className="px-5 py-3.5">Subject</th>
                <th className="px-5 py-3.5">Material</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Created by</th>
                <th className="px-5 py-3.5">Induction</th>
                <th className="px-5 py-3.5">Watched</th>
                <th className="px-5 py-3.5 text-right">{canCurate ? "Manage" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-ink-muted" style={{ fontSize: 15 }}>
                    {rows.length === 0
                      ? "No materials yet."
                      : "Nothing matches those filters."}
                    {canCurate && rows.length === 0 && " Add the first one above."}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const Icon = KIND_ICON[r.kind] ?? FileText;
                return (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{ borderColor: "var(--color-hairline)" }}
                  >
                    <td className="px-5 py-4 text-ink-soft whitespace-nowrap" style={{ fontSize: 14 }}>
                      {r.createdAt.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-4 font-bold text-ink-strong" style={{ fontSize: 14 }}>
                      {r.subject || <span className="text-ink-subtle font-normal">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 font-semibold hover:underline"
                          style={{ fontSize: 15, color: TRAINING_ACCENT }}
                        >
                          {r.title}
                          <ExternalLink size={13} strokeWidth={2.4} />
                        </a>
                      ) : (
                        <span className="font-semibold text-ink-strong" style={{ fontSize: 15 }}>
                          {r.title}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-ink-soft" style={{ fontSize: 14 }}>
                      <span className="inline-flex items-center gap-1.5">
                        <Icon size={15} strokeWidth={2.2} className="text-ink-subtle" />
                        {TRAINING_MATERIAL_KIND_LABELS[r.kind]}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-ink-soft" style={{ fontSize: 14 }}>
                      {r.createdByName ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      {r.isInduction ? (
                        <Tag>
                          <GraduationCap size={12} strokeWidth={2.6} />
                          Induction
                        </Tag>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => setWatched(r.id, !r.watchedByMe),
                            r.watchedByMe ? "Marked unwatched" : "Marked watched",
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 font-bold transition-colors disabled:opacity-50"
                        style={
                          r.watchedByMe
                            ? {
                                fontSize: 12,
                                background: "color-mix(in srgb, var(--color-green) 15%, transparent)",
                                color: "var(--color-green-deep)",
                                border: "1px solid color-mix(in srgb, var(--color-green) 32%, transparent)",
                              }
                            : {
                                fontSize: 12,
                                background: "rgba(15,23,42,0.04)",
                                color: "var(--color-ink-muted)",
                                border: "1px solid var(--color-hairline)",
                              }
                        }
                      >
                        {r.watchedByMe ? <Check size={13} strokeWidth={3} /> : <Eye size={13} strokeWidth={2.4} />}
                        {r.watchedByMe ? "Watched" : "Mark watched"}
                        {r.watchCount > 0 && (
                          <span className="tabular-nums opacity-70">· {r.watchCount}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      {canCurate && (
                        <div className="flex items-center justify-end gap-1.5">
                          <IconBtn
                            title={r.archived ? "Restore" : "Archive"}
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => setMaterialArchived(r.id, !r.archived),
                                r.archived ? "Restored" : "Archived",
                              )
                            }
                          >
                            {r.archived ? (
                              <ArchiveRestore size={15} strokeWidth={2.2} />
                            ) : (
                              <Archive size={15} strokeWidth={2.2} />
                            )}
                          </IconBtn>
                          <IconBtn
                            title="Delete"
                            danger
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
                              run(() => deleteMaterial(r.id), "Deleted");
                            }}
                          >
                            <Trash2 size={15} strokeWidth={2.2} />
                          </IconBtn>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40"
      style={{
        width: 32,
        height: 32,
        border: "1px solid var(--color-hairline)",
        color: danger ? "var(--color-red-deep)" : "var(--color-ink-muted)",
        background: "var(--color-surface-soft)",
      }}
    >
      {children}
    </button>
  );
}

function AddMaterialForm({
  subjects,
  onClose,
  onDone,
}: {
  subjects: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [kind, setKind] = React.useState<TrainingMaterialKind>("video_link");
  const [url, setUrl] = React.useState("");
  const [isInduction, setIsInduction] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createMaterial({ title, subject, kind, url, isInduction });
      if (res.ok) {
        toast.success("Material added");
        setTitle("");
        setUrl("");
        setIsInduction(false);
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-section bg-surface-card p-5 grid gap-3"
      style={{ border: "1px solid var(--color-hairline)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-ink-strong" style={{ fontSize: 16 }}>
          Add material
        </h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-subtle">
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
        <Field label="Name">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. How to create a Zoom link"
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
          />
        </Field>
        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            list="training-subjects"
            placeholder="e.g. Back Office"
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
          />
          <datalist id="training-subjects">
            {subjects.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Type">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TrainingMaterialKind)}
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
          >
            {TRAINING_MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {TRAINING_MATERIAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (Drive, Loom, YouTube)"
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong"
          />
        </Field>
      </div>

      <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isInduction}
          onChange={(e) => setIsInduction(e.target.checked)}
          className="size-4"
        />
        <span className="font-semibold text-ink-soft" style={{ fontSize: 14.5 }}>
          Part of induction — every new hire must complete this
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2.5 font-semibold text-ink-soft"
          style={{ fontSize: 14.5, border: "1px solid var(--color-hairline)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-60"
          style={{
            fontSize: 14.5,
            background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
          }}
        >
          {pending ? "Saving…" : "Add material"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
        style={{ fontSize: 11.5 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
