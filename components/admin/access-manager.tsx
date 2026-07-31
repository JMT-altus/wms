"use client";

import { useMemo, useState, useTransition } from "react";
import {
  LayoutGrid,
  Users,
  TrendingUp,
  GraduationCap,
  Search,
  RotateCcw,
  ShieldCheck,
  Info,
  type LucideIcon,
} from "lucide-react";
import { fireToast } from "@/lib/toast";
import { MODULES, MODULE_IDS, type ModuleId } from "@/lib/nav-modules";
import {
  ACCESS_SOURCE_LABEL,
  MODULE_CODE_DEFAULTS,
  resolveModuleAccess,
  type AccessDecision,
  type AccessLevel,
  type ResolvedGrants,
  type SubjectType,
} from "@/lib/access/modules";
import type {
  AccessDepartmentRow,
  AccessMatrix,
  AccessPersonRow,
} from "@/lib/queries/module-access";
import {
  bulkSetModuleAccess,
  clearSubjectAccess,
  setModuleAccess,
} from "@/app/(admin)/admin/access/actions";

const MODULE_ICONS: Record<ModuleId, LucideIcon> = {
  wms: LayoutGrid,
  employees: Users,
  sales: TrendingUp,
  training: GraduationCap,
};

type Tab = "everyone" | "departments" | "people";
type PeopleFilter = "all" | "admins" | "staff";

/** `subjectType|subjectId|moduleId`; `*` stands in for the org-wide rows. */
type GrantKey = string;
const gk = (t: SubjectType, id: string | null, m: ModuleId): GrantKey =>
  `${t}|${id ?? "*"}|${m}`;

interface Props {
  matrix: AccessMatrix;
}

export function AccessManager({ matrix }: Props) {
  const [tab, setTab] = useState<Tab>("everyone");
  const [pending, startTransition] = useTransition();

  // Local mirror of the grant rows so a toggle repaints (and re-derives every
  // "effective" chip) immediately; the server action reverts it on failure.
  const [grants, setGrants] = useState<Record<GrantKey, boolean>>(() => {
    const seed: Record<GrantKey, boolean> = {};
    const known = new Set<string>(MODULE_IDS);
    for (const g of matrix.grants) {
      if (!known.has(g.moduleId)) continue;
      seed[gk(g.subjectType, g.subjectId, g.moduleId as ModuleId)] = g.allowed;
    }
    return seed;
  });

  const levelOf = (t: SubjectType, id: string | null, m: ModuleId): AccessLevel => {
    const v = grants[gk(t, id, m)];
    return v === undefined ? "inherit" : v ? "allow" : "deny";
  };

  const everyoneGrants = useMemo(() => {
    const o: Partial<Record<ModuleId, boolean>> = {};
    for (const m of MODULE_IDS) {
      const v = grants[gk("everyone", null, m)];
      if (v !== undefined) o[m] = v;
    }
    return o;
  }, [grants]);

  const deptGrants = (deptIds: string[]): Partial<Record<ModuleId, boolean>> => {
    const o: Partial<Record<ModuleId, boolean>> = {};
    for (const m of MODULE_IDS) {
      for (const d of deptIds) {
        const v = grants[gk("department", d, m)];
        if (v === undefined) continue;
        // An allow from any one department wins — mirrors the server resolver.
        o[m] = (o[m] ?? false) || v;
      }
    }
    return o;
  };

  const personGrants = (p: AccessPersonRow): ResolvedGrants => {
    const own: Partial<Record<ModuleId, boolean>> = {};
    for (const m of MODULE_IDS) {
      const v = grants[gk("employee", p.id, m)];
      if (v !== undefined) own[m] = v;
    }
    return { everyone: everyoneGrants, department: deptGrants(p.departmentIds), employee: own };
  };

  const effectiveForEveryone = (m: ModuleId): AccessDecision =>
    resolveModuleAccess(
      m,
      { isAdmin: false, isSuperAdmin: false },
      { everyone: everyoneGrants, department: {}, employee: {} },
    );

  const effectiveForDept = (d: AccessDepartmentRow, m: ModuleId): AccessDecision =>
    resolveModuleAccess(
      m,
      { isAdmin: false, isSuperAdmin: false },
      { everyone: everyoneGrants, department: deptGrants([d.id]), employee: {} },
    );

  const effectiveForPerson = (p: AccessPersonRow, m: ModuleId): AccessDecision =>
    resolveModuleAccess(
      m,
      { isAdmin: p.isAdmin, isSuperAdmin: p.isSuperAdmin },
      personGrants(p),
    );

  function applyLocal(t: SubjectType, id: string | null, m: ModuleId, level: AccessLevel) {
    setGrants((prev) => {
      const next = { ...prev };
      if (level === "inherit") delete next[gk(t, id, m)];
      else next[gk(t, id, m)] = level === "allow";
      return next;
    });
  }

  function change(t: SubjectType, id: string | null, m: ModuleId, level: AccessLevel) {
    const before = grants[gk(t, id, m)];
    applyLocal(t, id, m, level);
    startTransition(async () => {
      const res = await setModuleAccess({ moduleId: m, subjectType: t, subjectId: id, level });
      if (!res.ok) {
        // Roll the optimistic edit back to exactly what it was.
        setGrants((prev) => {
          const next = { ...prev };
          if (before === undefined) delete next[gk(t, id, m)];
          else next[gk(t, id, m)] = before;
          return next;
        });
        fireToast({ message: res.error });
      }
    });
  }

  function resetSubject(t: "department" | "employee", id: string, label: string) {
    const before = { ...grants };
    setGrants((prev) => {
      const next = { ...prev };
      for (const m of MODULE_IDS) delete next[gk(t, id, m)];
      return next;
    });
    startTransition(async () => {
      const res = await clearSubjectAccess({ subjectType: t, subjectId: id });
      if (!res.ok) {
        setGrants(before);
        fireToast({ message: res.error });
        return;
      }
      fireToast({ message: `${label} now inherits its access.` });
    });
  }

  return (
    <div>
      <TabBar tab={tab} onChange={setTab} counts={{ departments: matrix.departments.length, people: matrix.people.length }} />

      <div className="mt-6">
        {tab === "everyone" && (
          <EveryoneTab
            levelOf={(m) => levelOf("everyone", null, m)}
            effective={effectiveForEveryone}
            onChange={(m, level) => change("everyone", null, m, level)}
            disabled={pending}
          />
        )}
        {tab === "departments" && (
          <DepartmentsTab
            departments={matrix.departments}
            levelOf={(d, m) => levelOf("department", d.id, m)}
            effective={effectiveForDept}
            onChange={(d, m, level) => change("department", d.id, m, level)}
            onReset={(d) => resetSubject("department", d.id, d.name)}
            onBulk={(moduleId, ids, level) =>
              startTransition(async () => {
                for (const id of ids) applyLocal("department", id, moduleId, level);
                const res = await bulkSetModuleAccess({
                  moduleId,
                  subjectType: "department",
                  subjectIds: ids,
                  level,
                });
                fireToast({
                  message: res.ok
                    ? `Updated ${res.count} department${res.count === 1 ? "" : "s"}.`
                    : res.error,
                });
              })
            }
            disabled={pending}
          />
        )}
        {tab === "people" && (
          <PeopleTab
            people={matrix.people}
            departments={matrix.departments}
            levelOf={(p, m) => levelOf("employee", p.id, m)}
            effective={effectiveForPerson}
            onChange={(p, m, level) => change("employee", p.id, m, level)}
            onReset={(p) => resetSubject("employee", p.id, p.name)}
            onBulk={(moduleId, ids, level) =>
              startTransition(async () => {
                for (const id of ids) applyLocal("employee", id, moduleId, level);
                const res = await bulkSetModuleAccess({
                  moduleId,
                  subjectType: "employee",
                  subjectIds: ids,
                  level,
                });
                fireToast({
                  message: res.ok
                    ? `Updated ${res.count} ${res.count === 1 ? "person" : "people"}.`
                    : res.error,
                });
              })
            }
            disabled={pending}
          />
        )}
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function TabBar({
  tab,
  onChange,
  counts,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  counts: { departments: number; people: number };
}) {
  const TABS: { id: Tab; label: string; hint: string }[] = [
    { id: "everyone", label: "Everyone", hint: "org-wide default" },
    { id: "departments", label: "Departments", hint: `${counts.departments}` },
    { id: "people", label: "People", hint: `${counts.people}` },
  ];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full p-1"
      style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}
    >
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className="rounded-full px-4 py-2 text-[14px] font-semibold transition-all"
            style={
              active
                ? {
                    background: "linear-gradient(135deg, #0A6CFF 0%, #0A6CFF 42%, #17B6A0 100%)",
                    color: "#fff",
                    boxShadow: "0 8px 20px -10px rgba(10,108,255,0.55)",
                  }
                : { color: "var(--color-ink-soft)" }
            }
          >
            {t.label}
            <span className="ml-2 text-[12px] font-bold opacity-70 tabular-nums">{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── The tri-state cell ───────────────────────────────────────────────── */

const LEVEL_META: Record<AccessLevel, { label: string; title: string; bg: string; fg: string }> = {
  inherit: { label: "Auto", title: "Inherit from the broader scope", bg: "rgba(100,116,139,0.16)", fg: "#334155" },
  allow: { label: "On", title: "Grant access", bg: "rgba(21,128,61,0.92)", fg: "#ffffff" },
  deny: { label: "Off", title: "Block access", bg: "rgba(185,28,28,0.92)", fg: "#ffffff" },
};

function LevelPicker({
  level,
  effective,
  onChange,
  disabled,
  locked,
}: {
  level: AccessLevel;
  effective: AccessDecision;
  onChange: (level: AccessLevel) => void;
  disabled?: boolean;
  /** Super-admins can't be restricted — render the state, hide the controls. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold"
        style={{ background: "rgba(21,128,61,0.12)", color: "#15803d" }}
        title="Super-admins always have every module."
      >
        <ShieldCheck size={13} strokeWidth={2.6} />
        Always
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        className="inline-flex items-center rounded-lg p-0.5"
        style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}
      >
        {(["inherit", "allow", "deny"] as AccessLevel[]).map((l) => {
          const on = l === level;
          const meta = LEVEL_META[l];
          return (
            <button
              key={l}
              type="button"
              disabled={disabled}
              onClick={() => onChange(l)}
              aria-pressed={on}
              title={meta.title}
              className="rounded-[6px] px-2 py-1 text-[11.5px] font-bold transition-all disabled:opacity-60"
              style={on ? { background: meta.bg, color: meta.fg } : { color: "var(--color-ink-subtle)" }}
            >
              {meta.label}
            </button>
          );
        })}
      </span>
      {level === "inherit" && (
        <span
          className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.06em]"
          style={{ color: effective.allowed ? "#15803d" : "#b91c1c" }}
          title={ACCESS_SOURCE_LABEL[effective.source]}
        >
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full"
            style={{ background: effective.allowed ? "#15803d" : "#b91c1c" }}
          />
          {effective.allowed ? "Visible" : "Hidden"}
        </span>
      )}
    </span>
  );
}

/* ── Everyone tab ─────────────────────────────────────────────────────── */

function EveryoneTab({
  levelOf,
  effective,
  onChange,
  disabled,
}: {
  levelOf: (m: ModuleId) => AccessLevel;
  effective: (m: ModuleId) => AccessDecision;
  onChange: (m: ModuleId, level: AccessLevel) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <Note>
        This is the default for <strong>everyone who isn&rsquo;t an admin</strong>. Admins skip
        this layer — to restrict an admin, set them individually on the People tab or via their
        department. Super-admins can never be restricted.
      </Note>

      <div
        className="overflow-hidden rounded-section border border-hairline bg-surface-card"
        style={{ boxShadow: "0 14px 32px -20px rgba(10,108,255,0.16), 0 2px 6px -2px rgba(15,23,42,0.06)" }}
      >
        {MODULES.map((m, i) => {
          const Icon = MODULE_ICONS[m.id];
          const eff = effective(m.id);
          return (
            <div
              key={m.id}
              className="flex items-center gap-4 px-5 py-4 border-b border-hairline last:border-b-0 flex-wrap"
              style={{ background: i % 2 === 1 ? "rgba(15,23,42,0.012)" : undefined }}
            >
              <span
                className="grid place-items-center rounded-xl shrink-0"
                style={{ width: 42, height: 42, background: `${m.accent.ink}14`, color: m.accent.ink }}
              >
                <Icon size={20} strokeWidth={2.3} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold text-ink-strong">{m.label}</div>
                <div className="text-[13px] text-ink-subtle truncate">{m.tagline}</div>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className="text-[12px] font-bold uppercase tracking-[0.06em] max-sm:hidden"
                  style={{ color: eff.allowed ? "#15803d" : "#b91c1c" }}
                >
                  Staff: {eff.allowed ? "visible" : "hidden"}
                </span>
                <LevelPicker
                  level={levelOf(m.id)}
                  effective={eff}
                  onChange={(l) => onChange(m.id, l)}
                  disabled={disabled}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-ink-subtle">
        With no row set, the built-in default applies:{" "}
        {MODULES.map((m, i) => (
          <span key={m.id}>
            {i > 0 && " · "}
            <span className="font-semibold text-ink-soft">{m.label}</span>{" "}
            {MODULE_CODE_DEFAULTS[m.id] ? "visible" : "hidden"}
          </span>
        ))}
        .
      </p>
    </div>
  );
}

/* ── Departments tab ──────────────────────────────────────────────────── */

function DepartmentsTab({
  departments,
  levelOf,
  effective,
  onChange,
  onReset,
  onBulk,
  disabled,
}: {
  departments: AccessDepartmentRow[];
  levelOf: (d: AccessDepartmentRow, m: ModuleId) => AccessLevel;
  effective: (d: AccessDepartmentRow, m: ModuleId) => AccessDecision;
  onChange: (d: AccessDepartmentRow, m: ModuleId, level: AccessLevel) => void;
  onReset: (d: AccessDepartmentRow) => void;
  onBulk: (m: ModuleId, ids: string[], level: AccessLevel) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (departments.length === 0) {
    return <Empty title="No departments yet" body="Create departments first — then you can grant a whole team a module in one click." />;
  }

  return (
    <div className="space-y-4">
      <Note>
        A department grant covers every member. Someone in two departments gets access if{" "}
        <strong>either</strong> department allows it. Department rows outrank the org-wide default
        and also apply to admins.
      </Note>

      <BulkBar
        count={selected.size}
        disabled={disabled}
        onApply={(m, level) => {
          onBulk(m, [...selected], level);
          setSelected(new Set());
        }}
        onClear={() => setSelected(new Set())}
      />

      <MatrixTable
        firstColLabel="Department"
        rows={departments.map((d) => ({
          id: d.id,
          selected: selected.has(d.id),
          onSelect: (on) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (on) next.add(d.id);
              else next.delete(d.id);
              return next;
            }),
          primary: (
            <>
              <span className="font-medium text-ink-strong">{d.name}</span>
              {!d.isActive && (
                <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "rgba(100,116,139,0.14)", color: "#475569" }}>
                  Inactive
                </span>
              )}
              <div className="text-[12.5px] text-ink-subtle tabular-nums">
                {d.memberCount} member{d.memberCount === 1 ? "" : "s"}
              </div>
            </>
          ),
          cell: (m: ModuleId) => (
            <LevelPicker
              level={levelOf(d, m)}
              effective={effective(d, m)}
              onChange={(l) => onChange(d, m, l)}
              disabled={disabled}
            />
          ),
          onReset: () => onReset(d),
        }))}
        disabled={disabled}
      />
    </div>
  );
}

/* ── People tab ───────────────────────────────────────────────────────── */

function PeopleTab({
  people,
  departments,
  levelOf,
  effective,
  onChange,
  onReset,
  onBulk,
  disabled,
}: {
  people: AccessPersonRow[];
  departments: AccessDepartmentRow[];
  levelOf: (p: AccessPersonRow, m: ModuleId) => AccessLevel;
  effective: (p: AccessPersonRow, m: ModuleId) => AccessDecision;
  onChange: (p: AccessPersonRow, m: ModuleId, level: AccessLevel) => void;
  onReset: (p: AccessPersonRow) => void;
  onBulk: (m: ModuleId, ids: string[], level: AccessLevel) => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");
  const [deptId, setDeptId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (filter === "admins" && !p.isAdmin) return false;
      if (filter === "staff" && p.isAdmin) return false;
      if (deptId && !p.departmentIds.includes(deptId)) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.email.toLowerCase().includes(needle) ||
        p.departmentNames.some((d) => d.toLowerCase().includes(needle))
      );
    });
  }, [people, q, filter, deptId]);

  const selectableIds = rows.filter((p) => !p.isSuperAdmin).map((p) => p.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <div className="space-y-4">
      <Note>
        A person&rsquo;s own setting wins over their department and over the org-wide default —
        it&rsquo;s the most specific level. Use it for one-off exceptions, including for other
        admins.
      </Note>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <Search size={16} strokeWidth={2.4} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email or department…"
            className="w-full rounded-xl border border-hairline bg-surface-card py-2.5 pl-9 pr-3 text-[14.5px] text-ink-strong placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-[rgba(10,108,255,0.35)]"
          />
        </label>
        <div className="inline-flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}>
          {(["all", "admins", "staff"] as PeopleFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold capitalize transition-all"
              style={filter === f ? { background: "#fff", color: "var(--color-ink-strong)", boxShadow: "0 2px 6px -2px rgba(15,23,42,0.18)" } : { color: "var(--color-ink-subtle)" }}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={deptId}
          onChange={(e) => setDeptId(e.target.value)}
          className="rounded-xl border border-hairline bg-surface-card px-3 py-2.5 text-[14px] text-ink-strong focus:outline-none focus:ring-2 focus:ring-[rgba(10,108,255,0.35)]"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <BulkBar
        count={selected.size}
        disabled={disabled}
        onApply={(m, level) => {
          onBulk(m, [...selected], level);
          setSelected(new Set());
        }}
        onClear={() => setSelected(new Set())}
      />

      {rows.length === 0 ? (
        <Empty title="No one matches" body="Try a different search or clear the filters." />
      ) : (
        <MatrixTable
          firstColLabel="Person"
          selectAll={{
            checked: allSelected,
            onChange: (on) =>
              setSelected(on ? new Set(selectableIds) : new Set()),
          }}
          rows={rows.map((p) => ({
            id: p.id,
            selected: selected.has(p.id),
            selectable: !p.isSuperAdmin,
            onSelect: (on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(p.id);
                else next.delete(p.id);
                return next;
              }),
            primary: (
              <>
                <span className="font-medium text-ink-strong">{p.name}</span>
                {p.isSuperAdmin ? (
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "rgba(124,58,237,0.14)", color: "#6d28d9" }}>
                    Super-admin
                  </span>
                ) : p.isAdmin ? (
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "rgba(10,108,255,0.12)", color: "#0A47B3" }}>
                    Admin
                  </span>
                ) : null}
                <div className="text-[12.5px] text-ink-subtle truncate">
                  {p.departmentNames.length > 0 ? p.departmentNames.join(" · ") : p.email}
                </div>
              </>
            ),
            cell: (m: ModuleId) => (
              <LevelPicker
                level={levelOf(p, m)}
                effective={effective(p, m)}
                onChange={(l) => onChange(p, m, l)}
                disabled={disabled}
                locked={p.isSuperAdmin}
              />
            ),
            onReset: p.isSuperAdmin ? undefined : () => onReset(p),
          }))}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

interface MatrixRow {
  id: string;
  primary: React.ReactNode;
  cell: (m: ModuleId) => React.ReactNode;
  selected: boolean;
  selectable?: boolean;
  onSelect: (on: boolean) => void;
  onReset?: () => void;
}

function MatrixTable({
  firstColLabel,
  rows,
  disabled,
  selectAll,
}: {
  firstColLabel: string;
  rows: MatrixRow[];
  disabled: boolean;
  selectAll?: { checked: boolean; onChange: (on: boolean) => void };
}) {
  return (
    <div
      className="overflow-hidden rounded-section border border-hairline bg-surface-card"
      style={{ boxShadow: "0 14px 32px -20px rgba(10,108,255,0.16), 0 2px 6px -2px rgba(15,23,42,0.06)" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr
              className="text-left text-[12px] uppercase tracking-[0.08em] text-ink-subtle font-bold border-b border-hairline"
              style={{ background: "var(--color-surface-soft)" }}
            >
              <th className="px-4 py-4 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={selectAll?.checked ?? false}
                  onChange={(e) => selectAll?.onChange(e.target.checked)}
                  disabled={!selectAll}
                  className="size-4 accent-[#0A6CFF] disabled:opacity-30"
                />
              </th>
              <th className="px-4 py-4 min-w-[200px]">{firstColLabel}</th>
              {MODULES.map((m) => (
                <th key={m.id} className="px-4 py-4 whitespace-nowrap">
                  {m.label}
                </th>
              ))}
              <th className="px-4 py-4 text-right">
                <span className="sr-only">Reset</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className="border-b border-hairline last:border-b-0 transition-colors hover:bg-surface-soft"
                style={{ background: i % 2 === 1 ? "rgba(15,23,42,0.012)" : undefined }}
              >
                <td className="px-4 py-3.5 align-top">
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={r.selected}
                    disabled={r.selectable === false}
                    onChange={(e) => r.onSelect(e.target.checked)}
                    className="mt-1 size-4 accent-[#0A6CFF] disabled:opacity-30"
                  />
                </td>
                <td className="px-4 py-3.5 align-top">{r.primary}</td>
                {MODULES.map((m) => (
                  <td key={m.id} className="px-4 py-3.5 align-top">
                    {r.cell(m.id)}
                  </td>
                ))}
                <td className="px-4 py-3.5 align-top text-right">
                  {r.onReset && (
                    <button
                      type="button"
                      onClick={r.onReset}
                      disabled={disabled}
                      title="Clear every override for this row"
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-subtle hover:text-ink-strong hover:bg-surface-soft transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={14} strokeWidth={2.4} />
                      Reset
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkBar({
  count,
  disabled,
  onApply,
  onClear,
}: {
  count: number;
  disabled: boolean;
  onApply: (m: ModuleId, level: AccessLevel) => void;
  onClear: () => void;
}) {
  const [moduleId, setModuleId] = useState<ModuleId>(MODULES[0]!.id);
  if (count === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: "linear-gradient(135deg, rgba(10,108,255,0.08), rgba(23,182,160,0.08))",
        border: "1px solid rgba(10,108,255,0.2)",
      }}
    >
      <span className="text-[14px] font-bold text-ink-strong tabular-nums">{count} selected</span>
      <select
        value={moduleId}
        onChange={(e) => setModuleId(e.target.value as ModuleId)}
        className="rounded-lg border border-hairline bg-surface-card px-3 py-2 text-[14px] text-ink-strong focus:outline-none focus:ring-2 focus:ring-[rgba(10,108,255,0.35)]"
      >
        {MODULES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {(["allow", "deny", "inherit"] as AccessLevel[]).map((l) => (
        <button
          key={l}
          type="button"
          disabled={disabled}
          onClick={() => onApply(moduleId, l)}
          className="rounded-lg px-3.5 py-2 text-[13.5px] font-bold transition-all disabled:opacity-50"
          style={{ background: LEVEL_META[l].bg, color: LEVEL_META[l].fg }}
        >
          {l === "inherit" ? "Reset to Auto" : l === "allow" ? "Turn On" : "Turn Off"}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[13px] font-semibold text-ink-subtle hover:text-ink-strong"
      >
        Clear selection
      </button>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-4 py-3"
      style={{ background: "rgba(10,108,255,0.06)", border: "1px solid rgba(10,108,255,0.16)" }}
    >
      <Info size={16} strokeWidth={2.4} style={{ color: "#0A6CFF", flexShrink: 0, marginTop: 2 }} />
      <p className="text-[13.5px] text-ink-soft" style={{ lineHeight: 1.55 }}>
        {children}
      </p>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-section border border-dashed border-hairline-strong bg-surface-card px-6 py-14 text-center"
      style={{ boxShadow: "0 14px 32px -20px rgba(10,108,255,0.16)" }}
    >
      <p className="font-serif text-ink-strong" style={{ fontStyle: "italic", fontSize: 22, letterSpacing: "-0.015em" }}>
        {title}
      </p>
      <p className="text-[14px] text-ink-subtle mt-2 max-w-sm mx-auto" style={{ lineHeight: 1.5 }}>
        {body}
      </p>
    </div>
  );
}
