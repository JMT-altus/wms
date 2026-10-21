import { z } from "zod";
import { TEXT_LIMIT, cleanText } from "@/lib/collections/master/normalize";

/**
 * Setting a company's Sales Coordinator from the Collection Tracker. Pure —
 * safe to import from client components.
 *
 * Only holders of collection.coordinator.assign may do this (an explicit grant
 * in the permission matrix); the server checks that from the signed session
 * (lib/auth/capability.ts). The coordinator is the
 * same `coordinator_label` the Collection Master import writes — there is no
 * second coordinator field. A choice must be one of the labels already in the
 * Collection Master (never a free-typed or invented name), and it can never be
 * blank, so a valid assignment can't be cleared by accident.
 */
export const CoordinatorAssignmentInput = z
  .object({
    companyId: z.string().uuid("Choose a company."),
    coordinatorLabel: z
      .string()
      .transform(cleanText)
      .pipe(z.string().min(1, "Choose a Sales Coordinator.").max(TEXT_LIMIT, "Choose a Sales Coordinator.")),
    /**
     * The coordinator the screen showed when the choice was made (null =
     * Unassigned). The save goes through only if the company still has exactly
     * that value, so a stale screen can't overwrite someone else's change.
     */
    expected: z.string().max(TEXT_LIMIT).nullable(),
  })
  .strict();

export type CoordinatorAssignmentInputT = z.infer<typeof CoordinatorAssignmentInput>;
