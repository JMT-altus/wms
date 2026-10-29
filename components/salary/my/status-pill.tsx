import { CheckCircle2, Clock } from "lucide-react";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/salary/money";
import { TONE } from "@/components/attendance/overview/theme";

/**
 * Paid, partly paid or pending: the run's disbursement state, nothing inferred.
 * "tinted" colours it (green / amber) for tables and lists; "neutral" is the
 * quiet light-grey pill the Net Pay card uses, where the status reads from its
 * icon and words.
 */
export function PaymentStatusPill({ status, size = "md", variant = "tinted" }: { status: PaymentStatus; size?: "sm" | "md"; variant?: "tinted" | "neutral" }) {
  const tone = status === "paid" ? TONE.teal : TONE.amber;
  const Icon = status === "paid" ? CheckCircle2 : Clock;
  const style = variant === "neutral" ? { background: "#F1F3F5", color: "#172B4D" } : { background: tone.bg, color: tone.fg };
  return (
    <span
      data-payment-status={status}
      data-variant={variant}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${size === "sm" ? "rounded-full px-2 py-0.5 text-[11.5px]" : "rounded-lg px-3.5 py-2 text-[13px]"}`}
      style={style}
    >
      <Icon size={size === "sm" ? 12 : 15} aria-hidden />
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}
