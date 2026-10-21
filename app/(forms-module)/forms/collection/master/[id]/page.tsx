import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { requireCollectionCapability } from "@/lib/auth/capability";
import { getMasterCompany } from "@/lib/queries/collection-master";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold text-ink-strong">{children}</dd>
    </div>
  );
}

/** One Collection Master company. Read-only: values change only through an import. */
export default async function CollectionMasterCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCollectionCapability("collection.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { storageReady, company: c } = await getMasterCompany(id);
  if (!storageReady || !c) notFound();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link href={"/forms/collection/master" as Route} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-bold text-[#0B4FB8]">
        <ArrowLeft size={14} aria-hidden /> Collection Master
      </Link>
      <header>
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          {c.companyName}
        </div>
      </header>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label="Sales Coordinator">{c.coordinatorLabel ?? <span className="text-ink-subtle">Unassigned</span>}</Fact>
        <Fact label="Payment Terms">{c.paymentTerms ?? <span className="text-ink-subtle">Not given</span>}</Fact>
        <Fact label="Client Master">
          {c.clientMatch === "linked" && c.clientMasterName ? (
            c.clientMasterName
          ) : c.clientMatch === "ambiguous" ? (
            <span className="text-[#B45309]">More than one client has this name — not linked</span>
          ) : (
            <span className="text-ink-subtle">Not linked</span>
          )}
        </Fact>
        <Fact label="Added">
          {formatDate(c.createdAt)}
          {c.createdImport?.fileName ? <span className="font-normal text-ink-muted"> · from {c.createdImport.fileName}</span> : null}
        </Fact>
        <Fact label="Last changed">
          {formatDate(c.updatedAt)}
          {c.lastImport ? (
            <span className="font-normal text-ink-muted">
              {c.lastImport.fileName ? ` · ${c.lastImport.fileName}` : ""}
              {c.lastImport.importedByName ? ` · by ${c.lastImport.importedByName}` : ""}
            </span>
          ) : null}
        </Fact>
      </dl>
      <p className="text-[12.5px] text-ink-subtle">
        The Sales Coordinator is the label from the master file; it is not linked to an employee record. To change a value, upload the master file again and accept the change in the preview.
      </p>
    </div>
  );
}
