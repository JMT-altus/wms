/**
 * Superseded: the administrators' Salary page is built from
 * components/salary/admin/* (payroll card, breakdown, runs report, history,
 * generate button). This file only re-exports the report so older imports
 * keep resolving — delete it once nothing imports it.
 */
export { SalaryRunsReport } from "./admin/salary-runs-report";
export type { PayrollSummary as SalaryRunSummary } from "@/lib/salary/payroll";
