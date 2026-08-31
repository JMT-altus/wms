import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, employees, taskAudience } from "@/db/schema";
import type { AudienceEntry } from "@/lib/access/visibility";

export interface TaskAttachment {
  id: string;
  title: string;
  /** null for a link row. */
  storagePath: string | null;
  /** null for a file row. */
  linkUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

/**
 * Everything attached to a task, files and links together, oldest first.
 *
 * No visibility filtering here on purpose: the caller has already proved it can
 * see the TASK, and an attachment is part of the task. Filtering again with a
 * different rule is how two screens end up disagreeing about what exists.
 */
export async function listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      storagePath: documents.storagePath,
      linkUrl: documents.linkUrl,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      uploadedById: documents.uploadedById,
      uploadedByName: employees.name,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(employees, eq(employees.id, documents.uploadedById))
    .where(eq(documents.taskId, taskId))
    .orderBy(asc(documents.createdAt));

  return rows.map((r) => ({
    ...r,
    uploadedByName: r.uploadedByName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The named audience of a restricted task, for the visibility editor. */
export async function getTaskAudience(taskId: string): Promise<AudienceEntry[]> {
  const rows = await db
    .select({ kind: taskAudience.kind, refId: taskAudience.refId })
    .from(taskAudience)
    .where(eq(taskAudience.taskId, taskId));
  return rows.map((r) => ({ kind: r.kind, refId: r.refId }));
}
