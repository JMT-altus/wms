import { Construction } from "lucide-react";

/**
 * Minimal placeholder for a Client KYC sub-page that doesn't have a real
 * screen yet — keeps every link in the sidebar dropdown clickable instead of
 * 404ing, without pretending any of them are built out.
 */
export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="rounded-section border border-hairline bg-surface-card px-8 py-16 text-center">
      <div
        className="mx-auto mb-4 grid place-items-center rounded-full"
        style={{ width: 48, height: 48, background: "var(--color-surface-soft)" }}
      >
        <Construction size={22} strokeWidth={2} className="text-ink-subtle" />
      </div>
      <h1
        className="font-bold text-ink-strong"
        style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 22 }}
      >
        {title}
      </h1>
      <p className="mt-2 text-ink-muted" style={{ fontSize: 14.5 }}>
        {note ?? "This screen hasn't been built yet."}
      </p>
    </div>
  );
}
