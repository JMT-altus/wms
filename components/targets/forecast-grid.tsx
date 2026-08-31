"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Pencil,
} from "lucide-react";
import { formatInrCompactPaise } from "@/lib/format";
import type { ForecastGridRow } from "@/lib/queries/targets";
import type { ForecastPeriodKind } from "@/db/enums";
import { CenterDialog } from "@/components/ui/center-dialog";
import { DictateButton } from "@/components/ui/dictate-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteForecastLine,
  redivideForecast,
  saveEstimate,
  saveForecastLine,
  seedPeriodFromBook,
} from "@/app/(targets-module)/targets/actions";
import { TARGETS_GRADIENT_BAR } from "./theme";
import {
  AchievementPill,
  EmptyPanel,
  GhostButton,
  Money,
  PrimaryButton,
  RupeeInput,
  StatTile,
  Variance,
} from "./ui";

export interface CustomerOption {
  id: string;
  name: string;
  category: string | null;
  isMine: boolean;
}

/**
 * The forecast grid — one customer per row, per period.
 *
 * Forecasted / Estimated / Actual sit on the SAME row deliberately: the whole
 * point of the module is that the three numbers are comparable at a glance,
 * and splitting them across screens is what a spreadsheet already does badly.
 */
export function ForecastGrid({
  fyStartYear,
  periodKind,
  periodKey,
  periodLabel,
  rows,
  customers,
  employeeId,
  targetPaise,
  locked,
  canEditQty,
  canEditRate,
  canRedivide,
}: {
  fyStartYear: number;
  periodKind: ForecastPeriodKind;
  periodKey: string;
  periodLabel: string;
  rows: ForecastGridRow[];
  customers: CustomerOption[];
  employeeId: string;
  targetPaise: number;
  locked: boolean;
  canEditQty: boolean;
  canEditRate: boolean;
  canRedivide: boolean;
}) {
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<ForecastGridRow | "new" | null>(null);
  const [estimating, setEstimating] = React.useState<ForecastGridRow | null>(null);
  const [pending, start] = React.useTransition();

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.customerName ?? "New business").toLowerCase().includes(needle) ||
        (r.customerCategory ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const totals = React.useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          forecast: acc.forecast + r.forecastPaise,
          estimated: acc.estimated + (r.estimatedPaise ?? 0),
          actual: acc.actual + r.actualPaise,
        }),
        { forecast: 0, estimated: 0, actual: 0 },
      ),
    [rows],
  );
  const missingNotes = rows.filter(
    (r) => r.estimatedPaise !== null && !(r.estimatedNotes ?? "").trim(),
  ).length;

  function remove(row: ForecastGridRow) {
    const who = row.isNewBusiness ? "the New business row" : `"${row.customerName}"`;
    if (!confirm(`Remove ${who} from ${periodLabel}?`)) return;
    start(async () => {
      const res = await deleteForecastLine(row.id);
      if (res.ok) toast.success("Row removed.");
      else toast.error(res.error);
    });
  }

  function seed() {
    start(async () => {
      const res = await seedPeriodFromBook({ fyStartYear, periodKind, periodKey, employeeId });
      if (res.ok) toast.success(`Added ${res.id} row${res.id === "1" ? "" : "s"} from your customer book.`);
      else toast.error(res.error);
    });
  }

  function redivide() {
    if (!confirm(`Split every row in ${periodLabel} down into the level below? Rows already edited by hand are kept.`)) return;
    start(async () => {
      const res = await redivideForecast({
        fyStartYear,
        periodKind,
        periodKey,
        employeeId,
        overwriteEdited: false,
      });
      if (res.ok) toast.success(`Divided into ${res.id} rows below.`);
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <StatTile label="Target" paise={targetPaise} tone="target" sub={periodLabel} />
        <StatTile
          label="Forecast"
          paise={totals.forecast}
          tone="forecast"
          sub={
            targetPaise > 0
              ? `${Math.round((totals.forecast / targetPaise) * 100)}% of target`
              : "no target set"
          }
        />
        <StatTile label="Estimated" paise={totals.estimated} tone="estimated" sub="what reps now expect" />
        <StatTile
          label="Actual"
          paise={totals.actual}
          tone="actual"
          sub={
            totals.forecast > 0
              ? `${Math.round((totals.actual / totals.forecast) * 100)}% of forecast`
              : "imported from Tally"
          }
        />
      </div>

      <div className="flex items-center gap-2 mb-3 flex-nowrap max-md:flex-wrap">
        <div
          className="inline-flex items-center gap-2 rounded-chip px-3.5 h-9 bg-surface-card border border-hairline flex-1 min-w-0"
          style={{ maxWidth: 340 }}
        >
          <Search size={15} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers"
            className="bg-transparent outline-none text-[13.5px] w-full min-w-0 text-ink-strong"
          />
        </div>

        {locked && (
          <span
            className="inline-flex items-center gap-1.5 rounded-chip px-2.5 h-9 font-semibold whitespace-nowrap"
            style={{
              fontSize: 12.5,
              background: "color-mix(in srgb, var(--color-amber) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-amber) 32%, transparent)",
              color: "var(--color-amber-deep)",
            }}
          >
            <Lock size={13} strokeWidth={2.4} />
            Closed
          </span>
        )}
        {missingNotes > 0 && (
          <span
            className="rounded-chip px-2.5 h-9 inline-flex items-center font-semibold whitespace-nowrap"
            style={{
              fontSize: 12.5,
              background: "color-mix(in srgb, var(--color-red) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-red) 28%, transparent)",
              color: "var(--color-red-deep)",
            }}
          >
            {missingNotes} estimate{missingNotes === 1 ? "" : "s"} without a note
          </span>
        )}

        <div className="shrink-0 flex items-center gap-1.5 ml-auto">
          <GhostButton onClick={seed} disabled={pending || locked} title="Add every customer assigned to you">
            <Sparkles size={14} strokeWidth={2.4} />
            Seed from book
          </GhostButton>
          {canRedivide && (
            <GhostButton onClick={redivide} disabled={pending || rows.length === 0} title="Split down a level">
              <RefreshCw size={14} strokeWidth={2.4} />
              Divide down
            </GhostButton>
          )}
          <PrimaryButton onClick={() => setEditing("new")} disabled={locked}>
            <Plus size={14} strokeWidth={2.6} />
            Add customer
          </PrimaryButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyPanel title={`Nothing forecast for ${periodLabel} yet.`}>
          Use <strong>Seed from book</strong> to pull in every customer assigned to you, or add
          them one at a time. The pinned <strong>New business</strong> row is where the
          acquisition share of your target goes.
        </EmptyPanel>
      ) : (
        <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 980 }}>
              <thead>
                <tr
                  className="text-left uppercase tracking-[0.08em]"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))",
                    color: "var(--color-ink-soft)",
                  }}
                >
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Avg rate</th>
                  <th className="px-4 py-3 text-right">Forecast</th>
                  <th className="px-4 py-3 text-right">Estimated</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Var</th>
                  <th className="px-4 py-3 text-right">Ach</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const ach =
                    r.forecastPaise > 0 ? Math.round((r.actualPaise / r.forecastPaise) * 100) : null;
                  const noNote = r.estimatedPaise !== null && !(r.estimatedNotes ?? "").trim();
                  return (
                    <tr
                      key={r.id}
                      className="border-t"
                      style={{
                        borderColor: "var(--color-hairline)",
                        background: r.isNewBusiness
                          ? "color-mix(in srgb, var(--color-blue) 4%, transparent)"
                          : undefined,
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <strong className="text-ink-strong" style={{ fontSize: 13.5 }}>
                          {r.isNewBusiness ? "✦ New business" : r.customerName}
                        </strong>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft" style={{ fontSize: 13 }}>
                        {r.customerCategory ?? <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft" style={{ fontSize: 13 }}>
                        {r.quantity ?? <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money paise={r.avgRatePaise} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money paise={r.forecastPaise} bold />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Money paise={r.estimatedPaise} />
                          {noNote && (
                            <span
                              title="Estimate submitted without a note"
                              aria-label="Estimate submitted without a note"
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: "var(--color-red)",
                                display: "inline-block",
                              }}
                            />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money paise={r.actualPaise} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Variance paise={r.actualPaise - r.forecastPaise} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <AchievementPill pct={ach} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Actions for ${r.customerName ?? "New business"}`}
                                className="inline-flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface-soft transition-colors"
                                style={{ width: 32, height: 30, border: "1px solid var(--color-hairline)" }}
                              >
                                <MoreHorizontal size={16} strokeWidth={2.4} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEstimating(r)} disabled={locked}>
                                <Sparkles size={14} strokeWidth={2.3} />
                                Update estimate
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEditing(r)} disabled={locked}>
                                <Pencil size={14} strokeWidth={2.3} />
                                Edit forecast
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => remove(r)}
                                disabled={locked}
                                style={{ color: "var(--color-red-deep)" }}
                              >
                                <Trash2 size={14} strokeWidth={2.3} />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "var(--color-surface-soft)" }} className="border-t">
                  <td className="px-4 py-3 font-bold text-ink-strong" style={{ fontSize: 13.5 }} colSpan={4}>
                    Total · {rows.length} row{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-right"><Money paise={totals.forecast} bold /></td>
                  <td className="px-4 py-3 text-right"><Money paise={totals.estimated} bold /></td>
                  <td className="px-4 py-3 text-right"><Money paise={totals.actual} bold /></td>
                  <td className="px-4 py-3 text-right">
                    <Variance paise={totals.actual - totals.forecast} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <AchievementPill
                      pct={totals.forecast > 0 ? Math.round((totals.actual / totals.forecast) * 100) : null}
                    />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {editing !== null && (
        <LineDialog
          row={editing === "new" ? null : editing}
          fyStartYear={fyStartYear}
          periodKind={periodKind}
          periodKey={periodKey}
          periodLabel={periodLabel}
          employeeId={employeeId}
          customers={customers}
          taken={new Set(rows.map((r) => r.customerMasterId).filter(Boolean) as string[])}
          hasNewBusiness={rows.some((r) => r.isNewBusiness)}
          canEditQty={canEditQty}
          canEditRate={canEditRate}
          onClose={() => setEditing(null)}
        />
      )}

      {estimating && (
        <EstimateDialog row={estimating} periodLabel={periodLabel} onClose={() => setEstimating(null)} />
      )}
    </>
  );
}

/* ── Forecast row dialog ─────────────────────────────────────────────────── */

const LINE_FORM = "targets-line-form";

function LineDialog({
  row,
  fyStartYear,
  periodKind,
  periodKey,
  periodLabel,
  employeeId,
  customers,
  taken,
  hasNewBusiness,
  canEditQty,
  canEditRate,
  onClose,
}: {
  row: ForecastGridRow | null;
  fyStartYear: number;
  periodKind: ForecastPeriodKind;
  periodKey: string;
  periodLabel: string;
  employeeId: string;
  customers: CustomerOption[];
  taken: Set<string>;
  hasNewBusiness: boolean;
  canEditQty: boolean;
  canEditRate: boolean;
  onClose: () => void;
}) {
  const toRupees = (p: number | null) => (p == null ? "" : String(Math.round(p / 100)));
  const [customerId, setCustomerId] = React.useState(row?.customerMasterId ?? "");
  const [isNewBusiness, setIsNewBusiness] = React.useState(row?.isNewBusiness ?? false);
  const [quantity, setQuantity] = React.useState(row?.quantity == null ? "" : String(row.quantity));
  const [avgRate, setAvgRate] = React.useState(toRupees(row?.avgRatePaise ?? null));
  const [forecast, setForecast] = React.useState(toRupees(row?.forecastPaise ?? null));
  const [notes, setNotes] = React.useState(row?.notes ?? "");
  const [pending, start] = React.useTransition();

  // Qty × rate wins when both are present — showing the derived figure live
  // stops the typed Forecast box quietly disagreeing with the arithmetic.
  const derived =
    quantity.trim() !== "" && avgRate.trim() !== ""
      ? Math.round(Number(quantity) * Number(avgRate) * 100)
      : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveForecastLine(row?.id ?? null, {
        fyStartYear,
        periodKind,
        periodKey,
        employeeId,
        customerMasterId: isNewBusiness ? null : customerId,
        isNewBusiness,
        quantity,
        avgRateRupees: avgRate,
        forecastRupees: forecast || 0,
        notes,
      });
      if (res.ok) {
        toast.success(row ? "Forecast updated." : "Row added.");
        onClose();
      } else toast.error(res.error);
    });
  }

  const available = customers.filter((c) => c.id === row?.customerMasterId || !taken.has(c.id));

  return (
    <CenterDialog
      open
      accentBar={TARGETS_GRADIENT_BAR}
      width={600}
      title={row ? "Edit forecast" : "Add a forecast row"}
      subtitle={`${periodLabel} · quantity × average rate sets the figure when both are filled in.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 font-semibold text-ink-soft"
            style={{ fontSize: 14.5, border: "1px solid var(--color-hairline)" }}
          >
            Cancel
          </button>
          <PrimaryButton type="submit" form={LINE_FORM} disabled={pending}>
            {pending ? "Saving…" : row ? "Save changes" : "Add row"}
          </PrimaryButton>
        </>
      }
    >
      <form id={LINE_FORM} onSubmit={submit} className="grid gap-4">
        {!row && (
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isNewBusiness}
              disabled={hasNewBusiness}
              onChange={(e) => {
                setIsNewBusiness(e.target.checked);
                if (e.target.checked) setCustomerId("");
              }}
              className="size-4"
            />
            <span className="font-semibold text-ink-soft" style={{ fontSize: 14 }}>
              This is the New business row
              {hasNewBusiness && <span className="text-ink-subtle"> — already exists</span>}
            </span>
          </label>
        )}

        {!isNewBusiness && (
          <Field label="Customer" required>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required={!isNewBusiness}
              disabled={!!row}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong disabled:opacity-60"
            >
              <option value="">— pick a customer —</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isMine ? "★ " : ""}
                  {c.name}
                  {c.category ? ` · ${c.category}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Quantity"
            hint={canEditQty ? undefined : "You don't have rights to edit quantity."}
          >
            <input
              value={quantity}
              inputMode="decimal"
              disabled={!canEditQty}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums disabled:opacity-50"
            />
          </Field>
          <Field
            label="Average rate (₹)"
            hint={canEditRate ? undefined : "Admin-controlled — ask an admin to change this."}
          >
            <input
              value={avgRate}
              inputMode="decimal"
              disabled={!canEditRate}
              onChange={(e) => setAvgRate(e.target.value)}
              className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums disabled:opacity-50"
            />
          </Field>
        </div>

        <Field
          label="Forecast (₹)"
          hint={
            derived !== null
              ? `Quantity × rate gives ${formatInrCompactPaise(derived)} — that wins over this box.`
              : "Used when quantity and rate aren't both filled in."
          }
        >
          <input
            value={forecast}
            inputMode="decimal"
            disabled={derived !== null}
            onChange={(e) => setForecast(e.target.value)}
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums disabled:opacity-50"
          />
        </Field>

        <Field label="Notes">
          <div className="relative">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-chip px-3.5 py-2.5 pr-10 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong resize-y"
            />
            <span className="absolute top-2 right-2">
              <DictateButton getValue={() => notes} setValue={setNotes} title="Dictate notes" />
            </span>
          </div>
        </Field>
      </form>
    </CenterDialog>
  );
}

/* ── Estimate dialog (the 27th / Friday routine) ─────────────────────────── */

const ESTIMATE_FORM = "targets-estimate-form";

function EstimateDialog({
  row,
  periodLabel,
  onClose,
}: {
  row: ForecastGridRow;
  periodLabel: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = React.useState(
    row.estimatedPaise == null ? "" : String(Math.round(row.estimatedPaise / 100)),
  );
  const [notes, setNotes] = React.useState(row.estimatedNotes ?? "");
  const [pending, start] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveEstimate({
        lineId: row.id,
        estimatedRupees: amount,
        estimatedNotes: notes,
      });
      if (res.ok) {
        toast.success("Estimate saved.");
        onClose();
      } else toast.error(res.error);
    });
  }

  return (
    <CenterDialog
      open
      accentBar={TARGETS_GRADIENT_BAR}
      width={560}
      title={row.isNewBusiness ? "New business" : row.customerName ?? "Estimate"}
      subtitle={`${periodLabel} · what you now expect to actually come in.`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 font-semibold text-ink-soft"
            style={{ fontSize: 14.5, border: "1px solid var(--color-hairline)" }}
          >
            Cancel
          </button>
          <PrimaryButton type="submit" form={ESTIMATE_FORM} disabled={pending}>
            {pending ? "Saving…" : "Save estimate"}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <ReadOnly label="Forecast" paise={row.forecastPaise} />
        <ReadOnly label="Actual so far" paise={row.actualPaise} />
      </div>

      <form id={ESTIMATE_FORM} onSubmit={submit} className="grid gap-4">
        <Field label="Estimated (₹)" required>
          <input
            value={amount}
            inputMode="decimal"
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-chip px-3.5 h-11 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong tabular-nums"
          />
        </Field>

        <Field
          label="What did the customer actually say?"
          hint="An estimate with no note is flagged in the Hygiene tracker — tap the mic and just say it."
        >
          <div className="relative">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g. Confirmed 80 pcs for March, PO expected Friday"
              className="w-full rounded-chip px-3.5 py-2.5 pr-10 bg-surface-soft border border-hairline outline-none text-[15px] text-ink-strong resize-y"
            />
            <span className="absolute top-2 right-2">
              <DictateButton getValue={() => notes} setValue={setNotes} title="Dictate the note" />
            </span>
          </div>
        </Field>
      </form>
    </CenterDialog>
  );
}

function ReadOnly({ label, paise }: { label: string; paise: number }) {
  return (
    <div>
      <p className="uppercase font-bold tracking-[0.08em] text-ink-subtle" style={{ fontSize: 10.5 }}>
        {label}
      </p>
      <p className="font-bold text-ink-strong tabular-nums" style={{ fontSize: 17 }}>
        {formatInrCompactPaise(paise)}
      </p>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 uppercase font-bold tracking-[0.08em] text-ink-subtle"
        style={{ fontSize: 11 }}
      >
        {label}
        {required && <span style={{ color: "var(--color-red-deep)" }}> ·&nbsp;required</span>}
      </span>
      {children}
      {hint && (
        <span className="block mt-1 text-ink-subtle" style={{ fontSize: 12 }}>
          {hint}
        </span>
      )}
    </label>
  );
}
