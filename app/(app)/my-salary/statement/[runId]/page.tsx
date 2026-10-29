import { notFound } from "next/navigation";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getRun } from "@/lib/queries/salary";
import { SalaryStatement } from "@/components/salary/my/statement";
import { PAGE_GROUND } from "@/components/attendance/overview/theme";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One salary statement. An employee may open only their OWN run; an
 * administrator any run (the same rule as the PDF payslip route). Anyone else's
 * is a 404, not a 403, so the URL reveals nothing about whether a run exists.
 */
export default async function SalaryStatementPage({ params }: { params: Promise<{ runId: string }> }) {
  const me = await requireUser();
  const { runId } = await params;
  if (!UUID_RE.test(runId)) notFound();
  const run = await getRun(runId);
  if (!run || (!me.isAdmin && run.employeeId !== me.id)) notFound();
  const backHref = run.employeeId === me.id ? `/my-salary?month=${run.month}` : `/salary?month=${run.month}`;
  return (
    <>
      <div className="print:hidden">
        <DashboardHeader generatedAt={new Date()} title="Employees ▸ Salary statement" fullWidth />
      </div>
      <div style={{ background: PAGE_GROUND }} className="print:bg-white">
        <main className="w-full px-6 pt-6 pb-10 max-md:px-4 lg:px-8 print:p-0">
          <SalaryStatement run={run} backHref={backHref} />
        </main>
      </div>
      <div className="print:hidden [&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
