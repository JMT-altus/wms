/**
 * Money display for the salary pages. Pure and client-safe. Figures arrive as
 * whole PAISE (integers) from lib/salary/daily-report.ts, or as the rupee
 * numbers the salary tables store (two decimals); nothing here does arithmetic
 * beyond converting paise to a displayable rupee value.
 */

const INR2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹12,283.87" from whole paise. */
export const inrPaise = (paise: number): string => INR2.format(paise / 100);

/** "₹12,283.87" from a rupee figure stored with two decimals. */
export const inr2 = (rupees: number): string => INR2.format(rupees);

/** "− ₹200.00" / "+ ₹150.00" from signed paise, for breakdown lines. */
export function signedPaise(paise: number): string {
  if (paise === 0) return INR2.format(0);
  return `${paise < 0 ? "−" : "+"} ${INR2.format(Math.abs(paise) / 100)}`;
}

/** "1.5" / "21" — day counts without trailing zeros. */
export const days = (n: number): string => n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export type PaymentStatus = "paid" | "partial" | "pending";

/** The run's payment state as the pages label it. */
export function paymentStatusOf(run: { disbursed: boolean; disbursedAmount: number | null; netPayable: number }): PaymentStatus {
  if (!run.disbursed) return "pending";
  if (run.disbursedAmount != null && Math.round(run.disbursedAmount * 100) < Math.round(run.netPayable * 100)) return "partial";
  return "paid";
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  partial: "Partly paid",
  pending: "Payment pending",
};
