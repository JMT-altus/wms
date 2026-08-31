"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents, documentEvents, tasks } from "@/db/schema";
import type { Employee } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { canViewTask } from "@/lib/auth/task-visibility";
import { rateLimitOrError } from "@/lib/rate-limit";
import { getSupabaseAdmin, DOCUMENTS_BUCKET } from "@/lib/supabase/admin";

export type AttachResult =
  | { ok: true; id?: string; url?: string }
  | { ok: false; error: string };

const MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TTL_SECONDS = 60 * 5;

const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;

/**
 * Same deny-list the document library uses. An allow-list would have to be
 * maintained every time somebody needs a new file type, and the risk being
 * managed here is executables, not unusual-but-harmless formats. PDFs, images
 * and Office files all pass.
 */
const DISALLOWED_EXTENSIONS =
  /\.(exe|com|cmd|bat|msi|scr|pif|vbs|js|mjs|cjs|jar|sh|bash|app|dmg|ps1|psm1|reg|hta|cpl|gadget)$/i;
const DISALLOWED_MIME_TYPES = new Set<string>([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-mach-binary",
  "application/vnd.microsoft.portable-executable",
  "application/x-sh",
  "application/x-shellscript",
  "text/x-shellscript",
]);

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

/**
 * Anyone who can SEE the task can attach to it.
 *
 * That is the point of the feature: when a doer sets a task to "Need info",
 * the person who can answer has to be able to put the file there. Gating
 * attachment on being the doer would break exactly the flow it exists for.
 */
/** The columns `canViewTask` needs, and nothing more. */
async function viewableTask(taskId: string): Promise<boolean> {
  const row = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    columns: {
      id: true,
      visibility: true,
      doerId: true,
      initiatorId: true,
      createdById: true,
    },
  });
  return row ? canViewTask(row) : false;
}

type Denied = { ok: false; error: string };

async function guardTask(
  taskId: string,
): Promise<{ me: Employee } | { error: Denied }> {
  if (!isUuid(taskId)) return { error: { ok: false, error: "Invalid task id." } };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return { error: limited };
  if (!(await viewableTask(taskId))) {
    return { error: { ok: false, error: "You don't have access to this task." } };
  }
  return { me };
}

async function logDocEvent(input: {
  documentId: string | null;
  documentTitle: string;
  actorId: string;
  eventType: "created" | "deleted";
  toValue?: unknown;
}): Promise<void> {
  try {
    await db.insert(documentEvents).values({
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      actorId: input.actorId,
      eventType: input.eventType,
      fromValue: null as never,
      toValue: (input.toValue ?? null) as never,
    });
  } catch (err) {
    // A logging failure must never lose an upload that already succeeded.
    console.warn("[task-attachments] audit write failed", err);
  }
}

/* ── Upload a file ───────────────────────────────────────────────────────── */

export async function attachFileToTask(form: FormData): Promise<AttachResult> {
  const taskId = String(form.get("taskId") ?? "");
  const g = await guardTask(taskId);
  if ("error" in g) return g.error;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file to attach." };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "File exceeds 25 MB." };
  if (DISALLOWED_EXTENSIONS.test(file.name) || (file.type && DISALLOWED_MIME_TYPES.has(file.type))) {
    return { ok: false, error: "This file type is not allowed." };
  }

  const title = String(form.get("title") ?? "").trim() || file.name;
  const path = `tasks/${taskId}/${Date.now()}-${safeName(file.name)}`;

  const sb = getSupabaseAdmin();
  const { error: upErr } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  try {
    const [row] = await db
      .insert(documents)
      .values({
        title: title.slice(0, 200),
        storagePath: path,
        linkUrl: null,
        mimeType: file.type || null,
        sizeBytes: file.size,
        taskId,
        uploadedById: g.me.id,
      })
      .returning({ id: documents.id });
    await logDocEvent({
      documentId: row!.id,
      documentTitle: title,
      actorId: g.me.id,
      eventType: "created",
      toValue: { taskId, mimeType: file.type || null, sizeBytes: file.size },
    });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, id: row!.id };
  } catch (err) {
    // The object is already in storage; drop it so a failed row doesn't leave
    // an orphan nobody can see or delete.
    await sb.storage.from(DOCUMENTS_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
}

/* ── Attach a link ───────────────────────────────────────────────────────── */

const LinkSchema = z.object({
  taskId: uuid,
  title: z.string().trim().min(1, "Give the link a name").max(200),
  url: z
    .string()
    .trim()
    .min(1, "Paste a link")
    .max(2000)
    // Only http(s). `javascript:` and `data:` URLs in an href are a
    // script-injection route, and no legitimate Drive link needs them.
    .refine((u) => /^https?:\/\//i.test(u), "Link must start with http:// or https://"),
});

export async function attachLinkToTask(input: unknown): Promise<AttachResult> {
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link" };
  }
  const { taskId, title, url } = parsed.data;

  const g = await guardTask(taskId);
  if ("error" in g) return g.error;

  try {
    const [row] = await db
      .insert(documents)
      .values({
        title,
        storagePath: null,
        linkUrl: url,
        mimeType: null,
        sizeBytes: null,
        taskId,
        uploadedById: g.me.id,
      })
      .returning({ id: documents.id });
    await logDocEvent({
      documentId: row!.id,
      documentTitle: title,
      actorId: g.me.id,
      eventType: "created",
      toValue: { taskId, linkUrl: url },
    });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, id: row!.id };
  } catch (err) {
    return { ok: false, error: `Could not save: ${(err as Error).message}` };
  }
}

/* ── Download ────────────────────────────────────────────────────────────── */

/**
 * A short-lived signed URL for one attachment.
 *
 * Minted per click rather than stored on the row: the bucket is private, and a
 * long-lived URL pasted into a chat would outlive the viewer's access to the
 * task.
 */
export async function getAttachmentUrl(documentId: string): Promise<AttachResult> {
  if (!isUuid(documentId)) return { ok: false, error: "Invalid id." };
  await requireUser();

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
    columns: { id: true, storagePath: true, linkUrl: true, taskId: true },
  });
  if (!doc) return { ok: false, error: "Attachment not found." };
  if (doc.linkUrl) return { ok: true, url: doc.linkUrl };
  if (!doc.storagePath) return { ok: false, error: "Attachment has no file." };

  // Re-check against the TASK, not the document: access to the file follows
  // access to the work it belongs to.
  if (doc.taskId && !(await viewableTask(doc.taskId))) {
    return { ok: false, error: "You don't have access to this task." };
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storagePath, DOWNLOAD_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return { ok: false, error: error?.message ?? "Could not create a download link." };
  }
  return { ok: true, url: data.signedUrl };
}

/* ── Remove ──────────────────────────────────────────────────────────────── */

/** Whoever attached it, or an admin. Matches the document library's rule. */
export async function removeTaskAttachment(documentId: string): Promise<AttachResult> {
  if (!isUuid(documentId)) return { ok: false, error: "Invalid id." };
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
    columns: {
      id: true,
      title: true,
      storagePath: true,
      taskId: true,
      uploadedById: true,
    },
  });
  if (!doc) return { ok: true };
  if (!me.isAdmin && doc.uploadedById !== me.id) {
    return { ok: false, error: "Only the person who attached this can remove it." };
  }

  if (doc.storagePath) {
    await getSupabaseAdmin()
      .storage.from(DOCUMENTS_BUCKET)
      .remove([doc.storagePath])
      .catch(() => {
        // Storage delete is best-effort: losing the row while the object
        // lingers is recoverable; the reverse would leave a dead link.
      });
  }
  await db.delete(documents).where(eq(documents.id, documentId));
  await logDocEvent({
    documentId: null,
    documentTitle: doc.title,
    actorId: me.id,
    eventType: "deleted",
  });
  if (doc.taskId) revalidatePath(`/tasks/${doc.taskId}`);
  return { ok: true };
}
