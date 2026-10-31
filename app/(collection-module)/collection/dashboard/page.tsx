import { CollectionDashboard } from "@/components/collections/collection-dashboard";
import { buildRows } from "@/lib/collections/derive";
import { loadCollectionParties } from "@/lib/collections/load";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { requireCollectionCapability } from "@/lib/auth/capability";

export const dynamic = "force-dynamic";

/**
 * Collection Dashboard. Reads parties through the same loader as the Tracker and
 * their follow-ups from the same table, so the two screens always agree. With no
 * accounting source connected it renders its empty states — no invented figures.
 */
export default async function CollectionDashboardPage() {
  // collection.view, checked before anything is loaded.
  await requireCollectionCapability("collection.view");
  const [source, followUps] = await Promise.all([loadCollectionParties(), listFollowUps()]);
  const rows = buildRows(source.parties, followUps.entries);

  return (
    <div>
      <header className="mb-4">
        <div
          role="heading"
          aria-level={1}
          className="text-ink-strong"
          style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15 }}
        >
          Collection Dashboard
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Outstanding and follow-up overview by party and collection person.
        </p>
      </header>
      <CollectionDashboard rows={rows} connected={source.connected} />
    </div>
  );
}
