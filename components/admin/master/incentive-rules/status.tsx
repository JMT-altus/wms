/** A version's status as a small badge, the same on every Incentive Rules screen. */
export type StatusName = "draft" | "submitted" | "approved" | "rejected" | "published" | "discarded";

export const STATUS_LABEL: Record<StatusName, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved — not yet published",
  rejected: "Rejected",
  published: "Published",
  discarded: "Discarded",
};
const TONE: Record<StatusName, [string, string]> = {
  draft: ["#475569", "#F1F5F9"],
  submitted: ["#B45309", "#FFFBEB"],
  approved: ["#0369A1", "#E0F2FE"],
  rejected: ["#B91C1C", "#FEF2F2"],
  published: ["#047857", "#ECFDF5"],
  discarded: ["#64748B", "#F8FAFC"],
};

export function StatusBadge({ status }: { status: StatusName }) {
  const [ink, bg] = TONE[status];
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ color: ink, background: bg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  create_program: "Programme created",
  update_program: "Programme changed",
  create: "Draft created",
  edit: "Draft edited",
  submit: "Submitted for approval",
  withdraw: "Submission withdrawn",
  approve: "Approved",
  reject: "Rejected",
  return_to_draft: "Returned to draft",
  publish: "Published",
  supersede: "Ended by a later version",
  discard: "Discarded",
};
