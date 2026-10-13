import { z } from "zod";
import { LEAVE_KINDS, LEAVE_TYPES } from "@/db/enums";
import { isRealIsoDate } from "@/lib/leave/workflow";

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isRealIsoDate, "Enter a real date");

const ReasonSchema = z.string().trim().max(1000).optional();

/**
 * Employee applies for leave for THEMSELVES. The employee, the approver and the
 * status are never part of the input — the server derives them from the session.
 */
export const ApplyForLeave = z
  .object({
    startDate: DateSchema,
    endDate: DateSchema,
    leaveType: z.enum(LEAVE_TYPES, { message: "Choose Emergency or Planned." }),
    reason: z.string().trim().min(1, "Reason for leave is required.").max(1000),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "Leave To Date can't be before Leave From Date.",
    path: ["endDate"],
  });

/** Verdict on a pending leave request. Rejecting needs a reason. */
export const DecideLeave = z
  .object({
    id: z.string().uuid(),
    verdict: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.verdict !== "rejected" || (v.note ?? "").length > 0, {
    message: "A reason is required to reject a leave request.",
    path: ["note"],
  });

/** Admin records an already-approved leave directly for an employee. */
export const AdminMarkLeave = z
  .object({
    employeeId: z.string().uuid(),
    kind: z.enum(LEAVE_KINDS),
    startDate: DateSchema,
    endDate: DateSchema,
    reason: ReasonSchema,
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });

/** Cancel a leave request (own pending, or any as admin). */
export const CancelLeave = z.object({ id: z.string().uuid() }).strict();

/** Admin: add an approver, make one the default, or remove one. */
export const SetLeaveApprover = z
  .object({
    employeeId: z.string().uuid(),
    action: z.enum(["make_default", "add", "remove"]),
  })
  .strict();

export type ApplyForLeaveInput = z.infer<typeof ApplyForLeave>;
export type DecideLeaveInput = z.infer<typeof DecideLeave>;
export type AdminMarkLeaveInput = z.infer<typeof AdminMarkLeave>;
export type CancelLeaveInput = z.infer<typeof CancelLeave>;
