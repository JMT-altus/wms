import { CheckCircle2, Clock } from "lucide-react";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/salary/money";

/** Paid in green; partly paid and pending in amber — the same badge colours as the leave statuses. */
const TINT: Record<PaymentStatus, { bg: string; fg: string; line: string }> = {
  paid: { bg: "#EAF7EF", fg: "#15803D", line: "#BFE5CD" },
  partial: { bg: "#FFF7E6", fg: "#B45309", line: "#F6DDA6" },
  pending: { bg: "#FFF7E6", fg: "#B45309", line: "#F6DDA6" },
};

/**
 * Paid, partly paid or pending: the run's disbursement state, nothing inferred.
 * "tinted" colours it (green / amber) for tables and lists; "neutral" is the
 * quiet grey badge the Net Pay card uses, where the status reads from its icon
 * and words.
 */
export function PaymentStatusPill({ status, size = "md", variant = "tinted" }: { status: PaymentStatus; size?: "sm" | "md"; variant?: "tinted" | "neutral" }) {
  const Icon = status === "paid" ? CheckCircle2 : Clock;
  const t = TINT[status];
  const style = variant === "neutral" ? { background: "#F3F6FA", color: "#0B1F44", border: "1px solid #DCE4F0" } : { background: t.bg, color: t.fg, border: `1px solid ${t.line}` };
  return (
    <span
      data-payment-status={status}
      data-variant={variant}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${size === "sm" ? "h-[22px] px-2 text-[11.5px]" : "h-7 px-2.5 text-[12.5px]"}`}
      style={style}
    >
      <Icon size={size === "sm" ? 12 : 13} aria-hidden />
      {PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}
