"use client";
import * as React from "react";
import { Check, Minus, RotateCcw, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { PERMISSION_FIELDS } from "@/db/enums";
import type { FieldMatrix } from "@/lib/queries/master-data";
import {
  FIELD_CODE_DEFAULTS,
  FIELD_SOURCE_LABEL,
  allowedToFieldLevel,
  fieldLevelToAllowed,
  resolveFieldAccess,
  type FieldAccessLevel,
} from "@/lib/access/field-permissions";
import {
  clearFieldSubject,
  setFieldPermission,
} from "@/app/(masters)/master-setup/actions";

type SubjectType = "everyone" | "department" | "employee";

/**
 * Field-level permission matrix — the layer beneath /admin/access (which
 * controls whole modules). Rows are fields, columns are the subject you picked.
 *
 * The live "effective" column runs the SAME pure resolver the server uses
 * (`resolveFieldAccess`), so what an admin sees here cannot drift from what
 * actually happens on a write.
 */
export function FieldAccessManager({ matrix }: { matrix: FieldMatrix }) {
  const [subjectType, setSubjectType] = React.useState<SubjectType>("everyone");
  const [subjectId, setSubjectId] = React.useState<string>("");
  const [pending, start] = React.useTransition();

  // Local echo of the saved grants so a click repaints immediately; the server
  // action revalidates and the prop catches up.
  //
  // Re-synced DURING render, not in an effect: after a revalidation we want the
  // very first paint to show the server's truth, not one frame of stale local
  // state that then flickers.
  const [grants, setGrants] = React.useState(matrix.grants);
  const [syncedFrom, setSyncedFrom] = React.useState(matrix.grants);
  if (matrix.grants !== syncedFrom) {
    setSyncedFrom(matrix.grants);
    setGrants(matrix.grants);
  }

  const activeSubjectId = subjectType === "everyone" ? null : subjectId || null;
  const subjectReady = subjectType === "everyone" || !!activeSubjectId;

  function levelFor(fieldKey: string): FieldAccessLevel {
    const g = grants.find(
      (x) =>
        x.fieldKey === fieldKey &&
        x.subjectType === subjectType &&
        (x.subjectId ?? null) === activeSubjectId,
    );
    return allowedToFieldLevel(g?.allowed);
  }

  /** What this person actually gets, once every level is resolved. */
  function effectiveFor(fieldKey: string) {
    const person =
      subjectType === "employee"
        ? matrix.people.find((p) => p.id === activeSubjectId)
        : undefined;

    const everyone = Object.fromEntries(
      grants
        .filter((g) => g.subjectType === "everyone")
        .map((g) => [g.fieldKey, g.allowed]),
    );
    const department = Object.fromEntries(
      grants
        .filter(
          (g) =>
            g.subjectType === "department" &&
            (subjectType === "department" ? g.subjectId === activeSubjectId : false),
        )
        .map((g) => [g.fieldKey, g.allowed]),
    );
    const employee = Object.fromEntries(
      grants
        .filter(
          (g) =>
            g.subjectType === "employee" &&
            (subjectType === "employee" ? g.subjectId === activeSubjectId : false),
        )
        .map((g) => [g.fieldKey, g.allowed]),
    );

    return resolveFieldAccess(
      fieldKey,
      { isAdmin: person?.isAdmin ?? false, isSuperAdmin: false },
      { everyone, department, employee },
    );
  }

  function apply(fieldKey: string, level: FieldAccessLevel) {
    if (!subjectReady) {
      toast.error("Pick who this applies to first.");
      return;
    }
    const allowed = fieldLevelToAllowed(level);
    // Optimistic local update — replace any existing row for this cell.
    setGrants((prev) => {
      const rest = prev.filter(
        (x) =>
          !(
            x.fieldKey === fieldKey &&
            x.subjectType === subjectType &&
            (x.subjectId ?? null) === activeSubjectId
          ),
      );
      return allowed === null
        ? rest
        : [...rest, { fieldKey, subjectType, subjectId: activeSubjectId, allowed }];
    });

    start(async () => {
      const res = await setFieldPermission(fieldKey, subjectType, activeSubjectId, allowed);
      if (!res.ok) {
        toast.error(res.error);
        setGrants(matrix.grants); // roll back to the server's truth
      }
    });
  }

  const overrideCount = grants.filter(
    (g) => g.subjectType === subjectType && (g.subjectId ?? null) === activeSubjectId,
  ).length;

  return (
    <div>
      {/* Subject picker */}
      <div
        className="rounded-section bg-surface-card p-5 mb-5"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <p
          className="uppercase font-bold tracking-[0.1em] text-ink-subtle mb-3"
          style={{ fontSize: 11 }}
        >
          Who does this apply to?
        </p>
        <div className="flex items-center gap-2.5 flex-wrap">
          {(
            [
              ["everyone", "Everyone (org default)"],
              ["department", "A department"],
              ["employee", "One person"],
            ] as [SubjectType, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setSubjectType(t);
                setSubjectId("");
              }}
              aria-pressed={subjectType === t}
              className="rounded-pill px-4 py-2.5 font-bold"
              style={
                subjectType === t
                  ? { fontSize: 14, background: "var(--color-ink-strong)", color: "#fff" }
                  : {
                      fontSize: 14,
                      background: "var(--color-surface-soft)",
                      color: "var(--color-ink-muted)",
                      border: "1px solid var(--color-hairline)",
                    }
              }
            >
              {label}
            </button>
          ))}

          {subjectType !== "everyone" && (
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="rounded-pill px-4 h-11 bg-surface-soft border border-hairline text-[14.5px] font-semibold text-ink-strong outline-none"
              style={{ minWidth: 220 }}
            >
              <option value="">
                {subjectType === "department" ? "— pick a department —" : "— pick a person —"}
              </option>
              {(subjectType === "department" ? matrix.departments : matrix.people).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          {subjectType !== "everyone" && activeSubjectId && overrideCount > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm("Clear every override for this subject?")) return;
                start(async () => {
                  const res = await clearFieldSubject(
                    subjectType as "department" | "employee",
                    activeSubjectId,
                  );
                  res.ok ? toast.success("Overrides cleared") : toast.error(res.error);
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-pill px-3.5 h-11 text-[14px] font-semibold text-ink-soft bg-surface-soft border border-hairline"
            >
              <RotateCcw size={14} strokeWidth={2.4} />
              Reset {overrideCount}
            </button>
          )}
        </div>

        <p className="mt-3 text-ink-muted" style={{ fontSize: 13 }}>
          Resolution order: <strong>person → department → admin → everyone → built-in default</strong>.
          Super-admins always have every right. Module-level access (which workspaces someone can
          open at all) lives in <a href="/admin/access" className="font-bold" style={{ color: "#0A6CFF" }}>Access</a>.
        </p>
      </div>

      {/* Matrix */}
      <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 760 }}>
            <thead>
              <tr
                className="text-left uppercase tracking-[0.08em] text-ink-subtle"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                <th className="px-4 py-3">Field</th>
                <th className="px-4 py-3" style={{ width: 250 }}>Setting</th>
                <th className="px-4 py-3">Effective</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_FIELDS.map((f) => {
                const level = levelFor(f.key);
                const eff = effectiveFor(f.key);
                return (
                  <tr key={f.key} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                        {f.label}
                      </p>
                      <p className="mt-0.5 text-ink-muted" style={{ fontSize: 12.5 }}>
                        {f.hint} · default{" "}
                        <strong>{FIELD_CODE_DEFAULTS[f.key] ? "allowed" : "denied"}</strong>
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="inline-flex rounded-pill overflow-hidden" style={{ border: "1px solid var(--color-hairline)" }}>
                        {(
                          [
                            ["inherit", "Inherit", Minus],
                            ["allow", "Allow", Check],
                            ["deny", "Deny", X],
                          ] as [FieldAccessLevel, string, typeof Check][]
                        ).map(([lv, label, Icon]) => {
                          const on = level === lv;
                          const tone = lv === "allow" ? "#15803d" : lv === "deny" ? "#b91c1c" : "#475569";
                          return (
                            <button
                              key={lv}
                              type="button"
                              disabled={pending || !subjectReady}
                              onClick={() => apply(f.key, lv)}
                              aria-pressed={on}
                              className="inline-flex items-center gap-1.5 px-3 py-2 font-bold disabled:opacity-45"
                              style={{
                                fontSize: 13,
                                background: on ? tone : "var(--color-surface-soft)",
                                color: on ? "#fff" : "var(--color-ink-muted)",
                              }}
                            >
                              <Icon size={13} strokeWidth={3} />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-bold"
                        style={{
                          fontSize: 11.5,
                          background: eff.allowed
                            ? "color-mix(in srgb, var(--color-green) 14%, transparent)"
                            : "color-mix(in srgb, var(--color-red) 11%, transparent)",
                          color: eff.allowed ? "var(--color-green-deep)" : "var(--color-red-deep)",
                          border: `1px solid color-mix(in srgb, var(--color-${eff.allowed ? "green" : "red"}) 30%, transparent)`,
                        }}
                      >
                        {eff.allowed ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                        {eff.allowed ? "Can edit" : "Read only"}
                      </span>
                      <p className="mt-1 text-ink-subtle" style={{ fontSize: 12 }}>
                        {FIELD_SOURCE_LABEL[eff.source]}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-ink-muted" style={{ fontSize: 13 }}>
        <ShieldCheck size={15} strokeWidth={2.3} className="shrink-0 mt-0.5" />
        Hiding a control is a courtesy, not a control — every server action calls{" "}
        <code className="font-mono">canEditField()</code> before honouring a write, so these
        settings hold even against a hand-crafted request.
      </p>
    </div>
  );
}
