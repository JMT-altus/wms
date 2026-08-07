"use client";
import * as React from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LOOKUP_LISTS } from "@/db/enums";
import type { LookupRow, SlabRow } from "@/lib/queries/master-data";
import {
  deleteIncentiveSlab,
  deleteLookupItem,
  saveIncentiveSlab,
  saveLookupItem,
} from "@/app/(masters)/master-setup/actions";
import { DataTable, Dash, Pill, type Column } from "./data-table";
import {
  CancelButton,
  Drawer,
  Field,
  RowBtn,
  SaveButton,
  TextInput,
  Toggle,
} from "./drawer";

export function LibrariesManager({
  lookups,
  slabs,
  overlaps,
}: {
  lookups: LookupRow[];
  slabs: SlabRow[];
  /** Pairs of slabs whose day ranges overlap — computed server-side. */
  overlaps: [string, string][];
}) {
  const [tab, setTab] = React.useState<"lists" | "slabs">("lists");

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {(
          [
            ["lists", `Dropdown lists · ${LOOKUP_LISTS.length}`],
            ["slabs", `Incentive slabs · ${slabs.length}`],
          ] as ["lists" | "slabs", string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="rounded-pill px-4 py-2.5 font-bold"
            style={
              tab === id
                ? { fontSize: 14, background: "var(--color-ink-strong)", color: "#fff" }
                : {
                    fontSize: 14,
                    background: "var(--color-surface-card)",
                    color: "var(--color-ink-muted)",
                    border: "1px solid var(--color-hairline)",
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "lists" ? <ListsTab lookups={lookups} /> : <SlabsTab slabs={slabs} overlaps={overlaps} />}
    </div>
  );
}

/* ── Editable dropdown lists ─────────────────────────────────────────────── */

function ListsTab({ lookups }: { lookups: LookupRow[] }) {
  const [editing, setEditing] = React.useState<
    { row: LookupRow | null; listKey: string } | null
  >(null);
  const [pending, start] = React.useTransition();

  return (
    <>
      <div className="grid gap-5">
        {LOOKUP_LISTS.map((list) => {
          const items = lookups.filter((l) => l.listKey === list.key);
          return (
            <section
              key={list.key}
              className="rounded-section bg-surface-card p-5"
              style={{ border: "1px solid var(--color-hairline)" }}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                  <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
                    {list.label}
                  </h2>
                  <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
                    {list.hint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({ row: null, listKey: list.key })}
                  className="inline-flex items-center gap-1.5 rounded-pill px-4 h-10 text-[14px] font-bold text-white"
                  style={{ background: "#0A6CFF" }}
                >
                  <Plus size={15} strokeWidth={2.6} />
                  Add option
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-ink-muted" style={{ fontSize: 14 }}>
                  No options yet — add the first one.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-3 rounded-chip px-4 py-2.5 bg-surface-soft"
                      style={{ border: "1px solid var(--color-hairline)" }}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="tabular-nums text-ink-subtle shrink-0"
                          style={{ fontSize: 12 }}
                        >
                          {it.sortOrder}
                        </span>
                        <span className="font-semibold text-ink-strong truncate" style={{ fontSize: 14.5 }}>
                          {it.label}
                        </span>
                        {!it.isActive && <Pill tone="slate">Hidden</Pill>}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <RowBtn title="Edit" onClick={() => setEditing({ row: it, listKey: list.key })}>
                          <Pencil size={14} strokeWidth={2.3} />
                        </RowBtn>
                        <RowBtn
                          title="Delete"
                          danger
                          disabled={pending}
                          onClick={() => {
                            if (!confirm(`Delete "${it.label}"?`)) return;
                            start(async () => {
                              const res = await deleteLookupItem(it.id);
                              res.ok ? toast.success("Option deleted") : toast.error(res.error);
                            });
                          }}
                        >
                          <Trash2 size={14} strokeWidth={2.3} />
                        </RowBtn>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <LookupForm
          row={editing.row}
          listKey={editing.listKey}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function LookupForm({
  row,
  listKey,
  onClose,
}: {
  row: LookupRow | null;
  listKey: string;
  onClose: () => void;
}) {
  const [label, setLabel] = React.useState(row?.label ?? "");
  const [sortOrder, setSortOrder] = React.useState(row?.sortOrder ?? 100);
  const [isActive, setIsActive] = React.useState(row?.isActive ?? true);
  const [pending, start] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveLookupItem(row?.id ?? null, { listKey, label, sortOrder, isActive });
      if (res.ok) {
        toast.success(row ? "Option updated" : "Option added");
        onClose();
      } else toast.error(res.error);
    });
  }

  const list = LOOKUP_LISTS.find((l) => l.key === listKey);

  return (
    <Drawer
      open
      title={row ? "Edit option" : "Add option"}
      subtitle={list?.label}
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Label" required>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first in the dropdown.">
          <TextInput type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </Field>
        <Toggle checked={isActive} onChange={setIsActive} label="Active — appears in the dropdown" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

/* ── Incentive slabs ─────────────────────────────────────────────────────── */

function SlabsTab({ slabs, overlaps }: { slabs: SlabRow[]; overlaps: [string, string][] }) {
  const [editing, setEditing] = React.useState<SlabRow | null | "new">(null);
  const [pending, start] = React.useTransition();

  const columns: Column<SlabRow>[] = [
    { key: "label", header: "Slab", render: (r) => r.label ?? <Dash /> },
    {
      key: "range",
      header: "Overdue days",
      value: (r) => `${r.overdueFromDays}–${r.overdueToDays ?? "∞"}`,
      render: (r) => (
        <span className="tabular-nums font-semibold text-ink-strong">
          {r.overdueFromDays}–{r.overdueToDays ?? "∞"}
        </span>
      ),
    },
    { key: "graceDays", header: "Grace days", align: "right" },
    {
      key: "payoutPct",
      header: "Payout %",
      align: "right",
      render: (r) => (
        <span className="tabular-nums font-black text-ink-strong">{Number(r.payoutPct)}%</span>
      ),
      value: (r) => r.payoutPct,
    },
    { key: "sortOrder", header: "Order", align: "right" },
    {
      key: "isActive",
      header: "Status",
      render: (r) => <Pill tone={r.isActive ? "green" : "slate"}>{r.isActive ? "Active" : "Inactive"}</Pill>,
      value: (r) => (r.isActive ? "Active" : "Inactive"),
    },
  ];

  return (
    <>
      {overlaps.length > 0 && (
        <div
          className="mb-4 flex items-start gap-3 rounded-chip px-4 py-3"
          style={{
            background: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-amber) 32%, transparent)",
          }}
        >
          <AlertTriangle
            size={18}
            strokeWidth={2.4}
            style={{ color: "var(--color-amber-deep)", flexShrink: 0, marginTop: 1 }}
          />
          <div style={{ color: "var(--color-amber-deep)" }}>
            <p className="font-bold" style={{ fontSize: 14.5 }}>
              {overlaps.length} overlapping slab{overlaps.length === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 font-semibold" style={{ fontSize: 13, opacity: 0.9 }}>
              Two slabs covering the same day means the payout depends on row order — fix the ranges
              so each overdue day falls in exactly one slab.
              {overlaps.slice(0, 3).map(([a, b], i) => (
                <span key={i} className="block">
                  · {a} overlaps {b}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}

      <DataTable
        rows={slabs}
        columns={columns}
        csvName="incentive-slabs"
        searchPlaceholder="Search slabs…"
        onNew={() => setEditing("new")}
        newLabel="New Slab"
        emptyTitle="No incentive slabs yet."
        emptySub="Define overdue-day bands and the payout percentage for each."
        actions={(r) => (
          <>
            <RowBtn title="Edit" onClick={() => setEditing(r)}>
              <Pencil size={14} strokeWidth={2.3} />
            </RowBtn>
            <RowBtn
              title="Delete"
              danger
              disabled={pending}
              onClick={() => {
                if (!confirm("Delete this slab?")) return;
                start(async () => {
                  const res = await deleteIncentiveSlab(r.id);
                  res.ok ? toast.success("Slab deleted") : toast.error(res.error);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={2.3} />
            </RowBtn>
          </>
        )}
      />

      {editing && <SlabForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SlabForm({ row, onClose }: { row: SlabRow | null; onClose: () => void }) {
  const [f, setF] = React.useState({
    label: row?.label ?? "",
    overdueFromDays: row?.overdueFromDays ?? 0,
    overdueToDays: row?.overdueToDays ?? "",
    graceDays: row?.graceDays ?? 0,
    payoutPct: row ? Number(row.payoutPct) : 0,
    sortOrder: row?.sortOrder ?? 100,
    isActive: row?.isActive ?? true,
  });
  const [pending, start] = React.useTransition();
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveIncentiveSlab(row?.id ?? null, f);
      if (res.ok) {
        toast.success(row ? "Slab updated" : "Slab created");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <Drawer
      open
      title={row ? "Edit slab" : "New slab"}
      subtitle="Overdue-day band → payout percentage."
      onClose={onClose}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <SaveButton pending={pending} />
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Label" hint="Optional, e.g. '0–30 days'.">
          <TextInput value={f.label} onChange={(e) => set("label", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Overdue from (days)" required>
            <TextInput
              type="number"
              min={0}
              value={f.overdueFromDays}
              onChange={(e) => set("overdueFromDays", Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Overdue to (days)" hint="Blank = open-ended (e.g. 60+).">
            <TextInput
              type="number"
              min={0}
              value={f.overdueToDays}
              onChange={(e) => set("overdueToDays", e.target.value)}
            />
          </Field>
          <Field label="Grace days">
            <TextInput
              type="number"
              min={0}
              value={f.graceDays}
              onChange={(e) => set("graceDays", Number(e.target.value))}
            />
          </Field>
          <Field label="Payout %" required>
            <TextInput
              type="number"
              step="0.001"
              min={0}
              max={100}
              value={f.payoutPct}
              onChange={(e) => set("payoutPct", Number(e.target.value))}
              required
            />
          </Field>
        </div>
        <Field label="Sort order">
          <TextInput type="number" value={f.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
        </Field>
        <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active" />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
