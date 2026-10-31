import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { requireFormsViewer } from "@/lib/auth/forms-access";
import { BATCH_ROW_SORTS, getBatchDetail, listBatchRows } from "@/lib/queries/tally-ledger";
import { readListParams, type SearchParams } from "@/lib/tally/list-params";
import { TALLY_CATEGORIES, type TallyCategoryKey } from "@/lib/tally/categories";
import { FORMS_ROUTES, sectionForCategory } from "@/lib/tally/sections";
import { BatchRows } from "@/components/forms/tally/batch-rows";
import { KeyValues, SectionHead, StatusPill, fmtDay, fmtWhen } from "@/components/forms/tally/ui";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One import batch from the history: what was uploaded, by whom, with which
 * column mapping, how it ended, and every row it recorded with its status,
 * reason and a link to the record it produced. Same gate as the import page
 * (Forms module + admin); nothing here imports, re-runs or deletes anything.
 */
export default async function TallyBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const viewer = await requireFormsViewer();
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const list = readListParams(await searchParams, BATCH_ROW_SORTS, { sort: "rowNo", dir: "asc" });
  const detail = await getBatchDetail(viewer, id);
  if (!detail) notFound();
  const page = await listBatchRows(viewer, id, list);
  const b = detail.batch;
  const category = TALLY_CATEGORIES[b.category as TallyCategoryKey];
  const section = sectionForCategory(b.category as TallyCategoryKey, b.direction);
  const n = (v: number) => v.toLocaleString("en-IN");
  return (
    <div>
      <SectionHead
        eyebrow="Forms · Tally Data Import · Batch"
        title={b.fileName}
        lede={
          <>
            {category?.label ?? b.category} · uploaded {fmtWhen(b.createdAt)}
            {b.uploadedBy ? ` by ${b.uploadedBy}` : ""} · <StatusPill status={b.status} />
          </>
        }
        back={{ href: FORMS_ROUTES.tallyImport, label: "Tally Data Import" }}
        right={
          <Link href={section.href} className="inline-flex h-9 items-center rounded-pill px-4 text-[13px] font-bold text-white" style={{ background: "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)" }}>
            Open {section.label} →
          </Link>
        }
      />
      <div className="mb-4 grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <KeyValues
          title="Import"
          items={[
            ["Batch", <span key="id" className="font-mono text-[12.5px]">{b.id}</span>],
            ["Category", category?.label ?? b.category],
            ["Destination", <Link key="d" href={section.href} className="font-semibold text-[#0B4FB8] underline-offset-2 hover:underline">{section.label}</Link>],
            ["File", `${b.fileName}${b.sheetName ? ` · sheet ${b.sheetName}` : ""}`],
            ["Uploaded by", b.uploadedBy],
            ["Uploaded", fmtWhen(b.createdAt)],
            ["Completed", fmtWhen(b.completedAt)],
            ["Status", <StatusPill key="s" status={b.status} />],
            ...(b.asOfDate ? ([["As of", fmtDay(b.asOfDate)], ["Direction", b.direction ?? "—"]] as const) : []),
            ...(b.financialYears.length ? ([["Financial years", `${b.financialYears.join(", ")}${b.isHistorical ? " (historical)" : ""}`]] as const) : []),
            ...(b.periodFrom ? ([["Period", `${fmtDay(b.periodFrom)} – ${fmtDay(b.periodTo)}`]] as const) : []),
            ["Attention rows", b.includeAttention ? "Imported (opted in)" : "Skipped"],
          ]}
        />
        <KeyValues
          title="Rows"
          items={[
            ["In file", n(b.totalRows)],
            ["Imported", <strong key="i" className="text-emerald-700">{n(detail.counts.imported)}</strong>],
            ["Skipped", n(detail.counts.skipped)],
            ["Rejected", <span key="r" className={detail.counts.rejected ? "text-red-700 font-bold" : ""}>{n(detail.counts.rejected)}</span>],
            ["Failed", <span key="f" className={detail.counts.failed ? "text-red-700 font-bold" : ""}>{n(detail.counts.failed)}</span>],
            ["Column mapping", Object.entries(b.mapping).length ? Object.entries(b.mapping).map(([k, c]) => `${category?.fields.find((f) => f.key === k)?.label ?? k} ← "${b.headers[c] ?? `column ${c + 1}`}"`).join(" · ") : "—"],
          ]}
        />
      </div>
      <BatchRows detail={detail} page={page} params={list} />
    </div>
  );
}
