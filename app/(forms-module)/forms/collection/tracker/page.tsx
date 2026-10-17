import { CollectionTracker } from "@/components/collections/collection-tracker";
import { buildRows } from "@/lib/collections/derive";
import { loadCollectionParties } from "@/lib/collections/load";
import { listFollowUps } from "@/lib/queries/collection-followups";
import { localDateString } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Collection Tracker — company-wise follow-ups. Companies come from the
 * Collection Master; amounts and due dates only from an approved transaction
 * source (none yet, so none are shown). Follow-up dates and notes come from the
 * saved history.
 */
export default async function CollectionTrackerPage() {
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
          Collection Tracker
        </div>
        <p className="mt-1 text-[14px] text-ink-subtle">
          Open a party to set its next follow-up date and keep date-wise notes.
        </p>
      </header>
      <CollectionTracker
        rows={rows}
        connected={source.connected}
        storageReady={followUps.storageReady}
        today={localDateString("Asia/Kolkata")}
        emptyMessage={source.message}
        transactionSource={source.transactions}
      />
    </div>
  );
}
