import { z } from "zod";
import { MODULE_IDS, type ModuleId } from "@/lib/nav-modules";
import { ACCESS_LEVELS, SUBJECT_TYPES } from "@/lib/access/modules";

const ModuleIdSchema = z.enum(MODULE_IDS as [ModuleId, ...ModuleId[]]);

/** One cell of the access matrix. `inherit` deletes the row rather than storing it. */
export const SetModuleAccessSchema = z
  .object({
    moduleId: ModuleIdSchema,
    subjectType: z.enum(SUBJECT_TYPES),
    subjectId: z.string().uuid("Invalid subject id").nullable().default(null),
    level: z.enum(ACCESS_LEVELS),
  })
  .refine(
    (v) => (v.subjectType === "everyone" ? v.subjectId === null : v.subjectId !== null),
    { message: "A department or employee must be named for this scope." },
  );
export type SetModuleAccessInput = z.input<typeof SetModuleAccessSchema>;

/** Apply one level to many subjects of the same type in a single write. */
export const BulkSetModuleAccessSchema = z.object({
  moduleId: ModuleIdSchema,
  subjectType: z.enum(["department", "employee"]),
  subjectIds: z
    .array(z.string().uuid("Invalid subject id"))
    .min(1, "Select at least one row")
    .max(500, "Too many rows selected"),
  level: z.enum(ACCESS_LEVELS),
});
export type BulkSetModuleAccessInput = z.infer<typeof BulkSetModuleAccessSchema>;

/** Wipe every explicit grant for one subject so it falls back to inherited. */
export const ClearSubjectAccessSchema = z.object({
  subjectType: z.enum(["department", "employee"]),
  subjectId: z.string().uuid("Invalid subject id"),
});
export type ClearSubjectAccessInput = z.infer<typeof ClearSubjectAccessSchema>;
