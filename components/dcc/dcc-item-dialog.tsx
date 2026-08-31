"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Trash2, Loader2 } from "lucide-react";
import { createDccItem, updateDccItem, deleteDccItem } from "@/app/(app)/dcc/actions";
import { parseFrequency, maskLabel } from "@/lib/dcc/util";
import { suggestCode, type BoardItem, type BoardClient } from "@/lib/dcc/board-model";

const FIELD =
  "w-full rounded-[10px] border border-hairline bg-surface-input px-3 py-2 text-[14px] text-ink-strong outline-none transition focus:border-altus-red";
const LABEL =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle";

export interface DccItemDialogProps {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  /** null = create mode. */
  item: BoardItem | null;
  /** Pre-fill the section when opened from a group's inline "Add". */
  defaultSection?: string | null;
  defaultClientId?: string | null;
  allItems: BoardItem[];
  clients: BoardClient[];
  sections: string[];
}

/**
 * Add / edit one KPI definition.
 *
 * Rendered through a PORTAL to document.body. The board sits inside cards that
 * use transforms and overflow-hidden, and a `position: fixed` overlay inside a
 * transformed ancestor is positioned against that ancestor instead of the
 * viewport — so without the portal the dialog renders clipped inside a card.
 */
export function DccItemDialog({
  open,
  onClose,
  ownerId,
  item,
  defaultSection,
  defaultClientId,
  allItems,
  clients,
  sections,
}: DccItemDialogProps) {
  const [mounted, setMounted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [section, setSection] = React.useState("");
  const [code, setCode] = React.useState("");
  const [frequency, setFrequency] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [isParticipantList, setIsParticipantList] = React.useState(false);
  /** Once the user types a code themselves, stop suggesting over the top. */
  const [codeTouched, setCodeTouched] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Reset EVERY time the dialog opens. Without this the previous KPI's values
  // linger into the next open — you click Add after editing "A6" and the form
  // is still full of A6.
  React.useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setSection(item?.section ?? defaultSection ?? "");
    setCode(item?.code ?? "");
    setFrequency(item?.frequency ?? "");
    setTarget(item?.targetNumber ?? "");
    setUnit(item?.unit ?? "");
    setClientId(item?.clientId ?? defaultClientId ?? "");
    setIsParticipantList(item?.isParticipantList ?? false);
    setCodeTouched(Boolean(item?.code));
    setSaving(false);
  }, [open, item, defaultSection, defaultClientId]);

  // Suggest the next code in the chosen section (A6 → A7) until the user
  // takes over the field.
  React.useEffect(() => {
    if (!open || codeTouched || item) return;
    const next = suggestCode(allItems, section);
    setCode(next);
  }, [open, section, codeTouched, item, allItems]);

  // Escape closes. Registered only while open so it doesn't fight other
  // dialogs on the page.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  // Live preview of how the parser reads the frequency, so nobody discovers
  // three weeks later that "asdf" quietly became ad-hoc.
  const parsed = parseFrequency(frequency);
  const parsedLabel =
    parsed.scheduleKind === "scheduled"
      ? `Due ${maskLabel(parsed.weekdays)}`
      : parsed.scheduleKind === "weekly"
        ? `Weekly${parsed.weekdays ? ` · ${maskLabel(parsed.weekdays)}` : ""}`
        : parsed.scheduleKind === "monthly"
          ? "Monthly"
          : parsed.scheduleKind === "event"
            ? "When it happens"
            : "Ad-hoc";

  async function save() {
    if (!title.trim()) {
      toast.error("Give the KPI a title");
      return;
    }
    setSaving(true);
    const payload = {
      section: section.trim() || null,
      code: code.trim() || null,
      title: title.trim(),
      frequency: frequency.trim() || null,
      targetNumber: target.trim() ? Number(target) : null,
      unit: unit.trim() || null,
      clientId: clientId || null,
      isParticipantList,
    };
    const res = item
      ? await updateDccItem({ id: item.id, ...payload })
      : await createDccItem({ ownerEmployeeId: ownerId, ...payload });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(item ? "KPI updated" : "KPI added");
    onClose();
  }

  async function remove() {
    if (!item) return;
    setSaving(true);
    const res = await deleteDccItem({ id: item.id });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Archived, not deleted — the fills against it stay as history.
    toast.success("KPI removed from the board");
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink-strong/40 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item ? "Edit KPI" : "Add KPI"}
        className="my-auto w-full max-w-[560px] rounded-[22px] border border-hairline bg-surface-card shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2
            className="text-[18px] font-black text-ink-strong"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {item ? "Edit KPI" : "Add KPI"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-subtle transition hover:bg-surface-track hover:text-ink-strong"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className={LABEL} htmlFor="dcc-title">
              Title *
            </label>
            <input
              id="dcc-title"
              className={FIELD}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Follow up on pending quotations"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <div>
              <label className={LABEL} htmlFor="dcc-section">
                Section
              </label>
              <input
                id="dcc-section"
                className={FIELD}
                list="dcc-sections"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="Weekly KPI"
              />
              <datalist id="dcc-sections">
                {sections.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={LABEL} htmlFor="dcc-code">
                Code
              </label>
              <input
                id="dcc-code"
                className={FIELD}
                value={code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value);
                }}
                placeholder="A7"
              />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="dcc-frequency">
              Frequency
            </label>
            <input
              id="dcc-frequency"
              className={FIELD}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder="Daily · Wed & Sat · Every Sat · Monthly · Adhoc"
            />
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-subtle">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{
                  background:
                    parsed.scheduleKind === "scheduled"
                      ? "var(--color-green)"
                      : parsed.needsReview
                        ? "var(--color-amber)"
                        : "var(--color-slate)",
                }}
              />
              Reads as: <strong className="text-ink-soft">{parsedLabel}</strong>
              {parsed.needsReview && " — won't count toward the daily checklist"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <div>
              <label className={LABEL} htmlFor="dcc-target">
                Target number
              </label>
              <input
                id="dcc-target"
                className={FIELD}
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="10"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="dcc-unit">
                Unit
              </label>
              <input
                id="dcc-unit"
                className={FIELD}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="calls"
              />
            </div>
          </div>

          {clients.length > 0 && (
            <div>
              <label className={LABEL} htmlFor="dcc-client">
                Client
              </label>
              <select
                id="dcc-client"
                className={FIELD}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">— none —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.section} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-hairline bg-surface-soft p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-green-deep)]"
              checked={isParticipantList}
              onChange={(e) => setIsParticipantList(e.target.checked)}
            />
            <span className="text-[13px] leading-snug text-ink-soft">
              <strong className="text-ink-strong">Participant-list KPI</strong>
              <br />
              Track a roster of people (mentees, vendors) with their own Done / NA
              per day. Kept out of the daily compliance count.
            </span>
          </label>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-4">
          {item ? (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-red-deep transition hover:bg-red-bg disabled:opacity-40"
            >
              <Trash2 size={15} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-[10px] border border-hairline px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-surface-track disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-bold text-white transition disabled:opacity-50"
              style={{ background: "var(--color-green-deep)" }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {item ? "Save changes" : "Add KPI"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
