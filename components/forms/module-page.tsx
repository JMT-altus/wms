import Link from "next/link";
import type { Route } from "next";
import { DashboardHeader } from "@/components/layout/header";
import { requireUser } from "@/lib/auth/current";
import { listModuleSubmissions } from "@/lib/queries/modules";
import { MODULES, type ModuleKey } from "@/lib/forms/modules";
import {
  resolveRequestFields,
  resolveAdminFields,
  resolveFields,
  requestKey,
  adminKey,
  getProductOptions,
} from "@/lib/forms/server";
import { DynamicFormDialog } from "./dynamic-form-dialog";
import { FormEditorDialog } from "./form-editor-dialog";
import { ModuleList } from "./module-list";

/** Per-module decision wording + headline field. */
const MODULE_UI: Record<ModuleKey, { grantLabel: string; approvedLabel: string; primaryKey: string }> = {
  reimbursement: { grantLabel: "Approve", approvedLabel: "Approved", primaryKey: "expense_for" },
  leave: { grantLabel: "Grant Leave", approvedLabel: "Granted", primaryKey: "leave_type" },
  reference: { grantLabel: "Mark Actioned", approvedLabel: "Actioned", primaryKey: "reference_name" },
  breakthrough: { grantLabel: "Acknowledge", approvedLabel: "Acknowledged", primaryKey: "participant_first_name" },
};

interface Props {
  module: ModuleKey;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function ModulePage({ module, searchParams }: Props) {
  const me = await requireUser();
  const sp = await searchParams;
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "archived" ? "archived" : "active";
  const def = MODULES[module];
  const ui = MODULE_UI[module];

  const [rows, requestFields, adminFieldsLive, products, requestFieldsRaw, adminFieldsRaw] = await Promise.all([
    listModuleSubmissions({ module, employeeId: me.id, isAdmin: me.isAdmin, archived: view === "archived" }),
    resolveRequestFields(module),
    resolveAdminFields(module),
    getProductOptions(),
    resolveFields(requestKey(module), def.requestFields),
    resolveFields(adminKey(module), def.adminFields),
  ]);

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const tab = (active: boolean) =>
    `px-4 py-2 text-[13.5px] font-bold transition-colors ${active ? "text-white" : "text-ink-soft"}`;

  // Reimbursements (Employees module) wear the approved WMS look; the other modules on this shared page keep theirs.
  if (module === "reimbursement") {
    const wmsTab = (active: boolean) =>
      `inline-flex h-8 items-center rounded-md px-3.5 text-[13px] font-semibold transition-colors ${active ? "bg-[#0A6CFF] text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)]" : "text-[#475569] hover:bg-[#F5F8FC] hover:text-[#0B1F44]"}`;
    return (
      <>
        <DashboardHeader generatedAt={new Date()} />
        <main className="emp-compact-page mx-auto w-full max-w-[1480px] px-10 pb-12 pt-4 max-lg:px-6 max-md:px-4" data-testid="reimbursements-main">
          <header className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="text-[#0B1F44]">{def.title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[#5B6B85]">
                {view === "archived" ? (
                  "Archived — restore or delete from the ⋯ menu."
                ) : me.isAdmin ? (
                  <>
                    <span
                      className="rounded-full border px-2 py-px text-[11.5px] font-semibold tabular-nums"
                      style={pendingCount > 0 ? { background: "#FFF7E6", borderColor: "#F6DDA6", color: "#B45309" } : { background: "#F5F8FC", borderColor: "#DCE4F0", color: "#475569" }}
                    >
                      {pendingCount} pending review
                    </span>
                    <span>{def.subtitle}</span>
                  </>
                ) : (
                  def.subtitle
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {me.isAdmin && (
                <>
                  <FormEditorDialog formKey={requestKey(module)} formName={`${def.title} — request`} fields={requestFieldsRaw} look="wms" triggerLabel="Edit request form" />
                  <FormEditorDialog formKey={adminKey(module)} formName={`${def.title} — admin fields`} fields={adminFieldsRaw} look="wms" triggerLabel="Edit admin fields" />
                </>
              )}
              <DynamicFormDialog module={module} title={def.title} buttonLabel={def.buttonLabel} fields={requestFields} productOptions={products} isAdmin={me.isAdmin} look="wms" />
            </div>
          </header>

          <nav aria-label="Reimbursement views" className="mb-3 inline-flex gap-0.5 rounded-lg border border-[#DCE4F0] bg-white p-0.5">
            <Link href={def.path as Route} className={wmsTab(view === "active")} aria-current={view === "active" ? "page" : undefined}>
              Active
            </Link>
            <Link href={`${def.path}?view=archived` as Route} className={wmsTab(view === "archived")} aria-current={view === "archived" ? "page" : undefined}>
              Archived
            </Link>
          </nav>

          <ModuleList
            rows={rows}
            isAdmin={me.isAdmin}
            requestFields={requestFields}
            adminFields={adminFieldsLive}
            productOptions={products}
            grantLabel={ui.grantLabel}
            approvedLabel={ui.approvedLabel}
            primaryKey={ui.primaryKey}
            view={view}
            layout="table"
          />
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="module-page-main mx-auto max-w-[900px] px-8 max-md:px-4 pt-8 pb-16">
        <header className="mb-6 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-display-lg text-ink-strong">{def.title}</h1>
            <p className="text-body-lg text-ink-subtle mt-1">
              {view === "archived"
                ? "Archived — restore or delete from the ⋯ menu."
                : me.isAdmin
                  ? `${pendingCount} pending review.`
                  : def.subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {me.isAdmin && (
              <>
                <FormEditorDialog formKey={requestKey(module)} formName={`${def.title} — request`} fields={requestFieldsRaw} />
                <FormEditorDialog formKey={adminKey(module)} formName={`${def.title} — admin fields`} fields={adminFieldsRaw} />
              </>
            )}
            <DynamicFormDialog
              module={module}
              title={def.title}
              buttonLabel={def.buttonLabel}
              fields={requestFields}
              productOptions={products}
              isAdmin={me.isAdmin}
            />
          </div>
        </header>

        <div className="mb-5 inline-flex rounded-full border border-hairline bg-surface-card overflow-hidden">
          <Link href={def.path as Route} className={tab(view === "active")} style={{ background: view === "active" ? "var(--color-altus-red)" : "transparent" }}>Active</Link>
          <Link href={`${def.path}?view=archived` as Route} className={tab(view === "archived")} style={{ background: view === "archived" ? "var(--color-altus-red)" : "transparent" }}>Archived</Link>
        </div>

        <ModuleList
          rows={rows}
          isAdmin={me.isAdmin}
          requestFields={requestFields}
          adminFields={adminFieldsLive}
          productOptions={products}
          grantLabel={ui.grantLabel}
          approvedLabel={ui.approvedLabel}
          primaryKey={ui.primaryKey}
          view={view}
        />
      </main>
    </>
  );
}
