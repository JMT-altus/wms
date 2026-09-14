"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { employees, projectNodeAttachments, projectNodes } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { getSupabaseAdmin, DOCUMENTS_BUCKET } from "@/lib/supabase/admin";

/**
 * Attachments on a CONTAINER plan row.
 *
 * Their own table, not the `documents` rows that back task attachments: those
 * hang off `tasks.id`, and a Milestone has no task. Same private bucket, same
 * signed-URL path — a new table, not a new storage system.
 *
 * EVERY mutation resolves the caller on the SERVER first. A client that posts
 * a `nodeId` it has nothing to do with proves nothing by the id alone.
 */

export interface PlanAttachment {
  id: string;
  fileName: string;
  mime: string | null;
  sizeBytes: number | null;
  uploadedByName: string | null;
  createdAt: string;
  /** Minted per read — see TTL below. */
  url: string | null;
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().uuid();

/** 20 MB. The document library's own cap is 25; a plan attachment is evidence
 *  on a milestone, not the deliverable itself. */
const MAX_BYTES = 20 * 1024 * 1024;

/** A copied URL must go stale. Ten minutes is long enough to open a PDF. */
const SIGNED_URL_TTL_SECONDS = 10 * 60;

/** The same deny-list the document library and task attachments use. */
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

type Guarded =
  | { ok: true; me: Awaited<ReturnType<typeof requireUser>> }
  | { ok: false; error: string };

/** Resolve the caller and prove the node exists, before anything else. */
async function guard(nodeId: string): Promise<Guarded> {
  if (!uuid.safeParse(nodeId).success) {
    return { ok: false, error: "Invalid row id." };
  }
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
    columns: { id: true, isArchived: true },
  });
  if (!node) return { ok: false, error: "That row no longer exists." };
  return { ok: true, me };
}

/**
 * The files on one row, with a freshly-minted signed URL each.
 *
 * Fetched ON OPEN, never with the register: a signed URL costs a round-trip
 * per file, so a page of sixty milestones would spend sixty of them on a
 * column nobody had clicked. The register carries counts only.
 */
export async function listPlanAttachments(
  nodeId: string,
): Promise<Result<{ files: PlanAttachment[] }>> {
  if (!uuid.safeParse(nodeId).success) return { ok: false, error: "Invalid row id." };
  await requireUser();

  let rows;
  try {
    rows = await db
      .select({
        id: projectNodeAttachments.id,
        fileName: projectNodeAttachments.fileName,
        storagePath: projectNodeAttachments.storagePath,
        mime: projectNodeAttachments.mime,
        sizeBytes: projectNodeAttachments.sizeBytes,
        uploadedByName: employees.name,
        createdAt: projectNodeAttachments.createdAt,
      })
      .from(projectNodeAttachments)
      .leftJoin(employees, eq(employees.id, projectNodeAttachments.uploadedById))
      .where(eq(projectNodeAttachments.nodeId, nodeId))
      .orderBy(asc(projectNodeAttachments.createdAt));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "42P01" || code === "42703") return { ok: true, files: [] };
    throw err;
  }

  if (rows.length === 0) return { ok: true, files: [] };

  const supabase = getSupabaseAdmin();
  const files = await Promise.all(
    rows.map(async (r) => {
      let url: string | null = null;
      try {
        const { data } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrl(r.storagePath, SIGNED_URL_TTL_SECONDS);
        url = data?.signedUrl ?? null;
      } catch {
        // A file whose URL could not be minted still LISTS — the row knows it
        // is there, and a missing link is better than a missing file.
        url = null;
      }
      return {
        id: r.id,
        fileName: r.fileName,
        mime: r.mime,
        sizeBytes: r.sizeBytes,
        uploadedByName: r.uploadedByName ?? null,
        createdAt: r.createdAt.toISOString(),
        url,
      };
    }),
  );
  return { ok: true, files };
}

export async function uploadPlanAttachment(form: FormData): Promise<Result<{ id: string }>> {
  const nodeId = String(form.get("nodeId") ?? "");
  const g = await guard(nodeId);
  if (!g.ok) return g;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file to attach." };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "That file is over 20 MB." };
  if (
    DISALLOWED_EXTENSIONS.test(file.name) ||
    (file.type && DISALLOWED_MIME_TYPES.has(file.type))
  ) {
    return { ok: false, error: "That file type isn't allowed." };
  }

  const storagePath = `project-nodes/${nodeId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const supabase = getSupabaseAdmin();
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  try {
    const [row] = await db
      .insert(projectNodeAttachments)
      .values({
        nodeId,
        storagePath,
        fileName: file.name.slice(0, 240),
        mime: file.type || null,
        sizeBytes: file.size,
        uploadedById: g.me.id,
      })
      .returning({ id: projectNodeAttachments.id });
    if (!row) throw new Error("Insert returned no row");
    revalidatePath("/project-plan");
    return { ok: true, id: row.id };
  } catch (err) {
    // The object is already up but the row is not — remove it rather than
    // leave a file nothing points at.
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]).catch(() => {});
    const code = (err as { code?: string } | null)?.code;
    if (code === "42P01") {
      return {
        ok: false,
        error:
          "Attachments aren't available yet — this database is missing migration 0103.",
      };
    }
    return { ok: false, error: `Could not attach: ${(err as Error).message}` };
  }
}

export async function deletePlanAttachment(attachmentId: string): Promise<Result> {
  if (!uuid.safeParse(attachmentId).success) {
    return { ok: false, error: "Invalid attachment id." };
  }
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const row = await db.query.projectNodeAttachments.findFirst({
    where: eq(projectNodeAttachments.id, attachmentId),
  });
  if (!row) return { ok: false, error: "That file is already gone." };

  // Best-effort object removal BEFORE the row is dropped, so a storage failure
  // leaves a row pointing at a real file rather than a file nothing points at.
  try {
    await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([row.storagePath]);
  } catch (err) {
    console.warn("[plan] attachment object removal failed", (err as Error).message);
  }

  await db.delete(projectNodeAttachments).where(eq(projectNodeAttachments.id, attachmentId));
  revalidatePath("/project-plan");
  return { ok: true };
}
