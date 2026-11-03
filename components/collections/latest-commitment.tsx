import { commitmentLabel } from "@/lib/collections/commitment-display";
import { fmtDateTime } from "@/lib/dates";

/**
 * The latest commitment record, rendered ONE way wherever it appears: the
 * company popup's Commitment History and the Collection Tracker's Collection
 * Amount Confirmation column. Both are given the newest stored commitment
 * (newest recorded time, then id — the same order on both reads), so they show
 * the same amount, committed date, CURRENT label, recorded time and recorder.
 *
 *   ₹15,00,000 – 04/11/26  CURRENT
 *   Recorded 02/11/26, 06:34 PM by Altus Corp
 */
export interface LatestCommitmentRecord {
  amount: string;
  committedDate: string;
  recordedAt: Date;
  recordedByName: string | null;
}

export function LatestCommitment({ record, compact = false }: { record: LatestCommitmentRecord; compact?: boolean }) {
  return (
    <>
      <p className={`font-semibold tabular-nums text-ink-strong ${compact ? "text-[13px]" : ""}`} data-latest-commitment="value">
        {commitmentLabel(record) ?? "—"}
        <span className="ml-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#047857]">Current</span>
      </p>
      <p className={`text-ink-subtle ${compact ? "text-[11.5px] leading-snug" : ""}`} data-latest-commitment="recorded">
        Recorded {fmtDateTime(record.recordedAt)}
        {record.recordedByName ? ` by ${record.recordedByName}` : ""}
      </p>
    </>
  );
}
