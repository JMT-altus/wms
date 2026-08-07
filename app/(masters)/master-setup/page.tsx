import Link from "next/link";
import type { Route } from "next";
import { Boxes, Contact, Library, KeyRound, DatabaseZap, ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/current";
import { getMasterDataCounts } from "@/lib/queries/master-data";
import { MasterPageHead } from "@/components/admin/master/page-head";

export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/master-setup/products",
    label: "Product Masters",
    hint: "Category → Product → SKU, with HP, power rating, flange and KVH.",
    icon: Boxes,
    keys: ["categories", "products", "skus"] as const,
    unit: "categories · products · SKUs",
  },
  {
    href: "/master-setup/customers",
    label: "Customer Masters",
    hint: "Profiles, sales-rep ownership, A/B/C class and buying behaviour.",
    icon: Contact,
    keys: ["customers"] as const,
    unit: "customers",
  },
  {
    href: "/master-setup/libraries",
    label: "System Libraries",
    hint: "Editable dropdowns and the incentive slab matrix.",
    icon: Library,
    keys: ["lookups", "slabs"] as const,
    unit: "options · slabs",
  },
  {
    href: "/master-setup/access-control",
    label: "Field Permissions",
    hint: "Who may edit quantities and average rates.",
    icon: KeyRound,
    keys: ["field_grants"] as const,
    unit: "overrides",
  },
  {
    href: "/master-setup/data-import",
    label: "Data Ingestion",
    hint: "Google Sheets / Tally dumps and the field mapper.",
    icon: DatabaseZap,
    keys: ["imports"] as const,
    unit: "imports run",
  },
];

export default async function MasterSetupOverviewPage() {
  await requireAdmin();
  const counts = await getMasterDataCounts();

  return (
    <div>
      <MasterPageHead
        eyebrow="Admin & Master Setup"
        title="Master Data"
        lede="The reference data the business runs on — catalogue, customers, libraries, permissions and ingestion. Separate from the Admin Panel, which handles people and org settings."
      />

      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const nums = c.keys.map((k) => counts[k] ?? 0);
          return (
            <Link
              key={c.href}
              href={c.href as Route}
              className="group rounded-section bg-surface-card p-5 transition-transform hover:-translate-y-0.5"
              style={{
                border: "1px solid var(--color-hairline)",
                boxShadow:
                  "0 14px 32px -20px rgba(245, 158, 11, 0.2), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
              }}
            >
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden
                  className="grid place-items-center rounded-xl shrink-0"
                  style={{
                    width: 44,
                    height: 44,
                    background: "color-mix(in srgb, var(--color-amber) 15%, transparent)",
                    color: "var(--color-amber-deep)",
                  }}
                >
                  <Icon size={21} strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
                    {c.label}
                  </p>
                  <p className="mt-1 text-ink-muted" style={{ fontSize: 13.5 }}>
                    {c.hint}
                  </p>
                  <p className="mt-2.5 tabular-nums font-black text-ink-strong" style={{ fontSize: 20 }}>
                    {nums.join(" · ")}
                    <span className="ml-2 font-semibold text-ink-subtle" style={{ fontSize: 12.5 }}>
                      {c.unit}
                    </span>
                  </p>
                </div>
                <ArrowRight
                  size={17}
                  strokeWidth={2.4}
                  className="shrink-0 mt-1 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
