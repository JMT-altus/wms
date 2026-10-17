import Link from "next/link";
import type { Route } from "next";
import { Inbox as InboxIcon } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { listInboxNotifications } from "@/lib/queries/notifications";
import { getStatusDisplayMap } from "@/lib/queries/status-display";
import type { TaskStatus, StatusColorToken } from "@/db/enums";
import { NotificationRow } from "./notification-row";
import { MarkAllButton } from "./mark-all-button";

// SSR-only for now — realtime push will land with the websocket pass.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function InboxPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await requireUser();

  const beforeRaw = firstString(sp["before"]);
  const before = (() => {
    if (!beforeRaw) return undefined;
    const d = new Date(beforeRaw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  })();

  const [{ notifications, nextCursor, hasMore }, statusDisplay] =
    await Promise.all([
      listInboxNotifications({ userId: me.id, isAdmin: me.isAdmin, before }),
      getStatusDisplayMap(),
    ]);

  const statusLabels = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.label]),
  ) as Record<TaskStatus, string>;
  const statusTones = Object.fromEntries(
    Object.entries(statusDisplay).map(([k, v]) => [k, v.color]),
  ) as Record<TaskStatus, StatusColorToken>;

  const isEmpty = notifications.length === 0;
  const hasUnread = notifications.some((n) => n.readAt === null);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="WMS · Inbox" />
      <main className="wms-fill mx-auto max-w-[960px] px-8 max-md:px-4 pt-6 pb-3">
        <header className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            {/* A heading div rather than <h1>: the global h1 rule forces a much
                larger size, which is what made this page title oversized. */}
            <div
              role="heading"
              aria-level={1}
              className="font-serif text-ink-strong"
              style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 700 }}
            >
              Inbox
            </div>
            <p className="mt-0.5 text-[13px] text-ink-subtle">
              Everything happening on tasks you're part of.
            </p>
          </div>
          {!isEmpty && <MarkAllButton hasUnread={hasUnread} />}
        </header>

        {isEmpty ? (
          <EmptyState isPaginated={Boolean(before)} />
        ) : (
          <section
            className="bg-surface-card rounded-xl border border-hairline overflow-hidden"
            style={{ boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)" }}
          >
            <ol>
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  row={n}
                  statusLabels={statusLabels}
                  statusTones={statusTones}
                />
              ))}
            </ol>
          </section>
        )}

        {hasMore && nextCursor && (
          <div className="mt-6 flex justify-center">
            <Link
              href={`/inbox?before=${encodeURIComponent(nextCursor)}` as Route}
              className="nav-pill"
              style={{
                background: "rgba(15, 23, 42, 0.06)",
                color: "var(--color-ink-strong)",
              }}
            >
              Load older
            </Link>
          </div>
        )}
      </main>
      <div className="[&>footer]:mt-6">
        <DashboardFooter />
      </div>
    </>
  );
}

function EmptyState({ isPaginated }: { isPaginated: boolean }) {
  return (
    <div
      className="bg-surface-card rounded-section border border-hairline p-10 text-center"
      style={{ boxShadow: "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}
    >
      <div
        aria-hidden
        className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--color-purple) 18%, white), color-mix(in srgb, var(--color-blue) 12%, white))",
          color: "var(--color-purple-deep)",
          border: "1px solid color-mix(in srgb, var(--color-purple) 25%, transparent)",
        }}
      >
        <InboxIcon className="h-6 w-6" />
      </div>
      <h2
        className="font-serif text-ink-strong"
        style={{
          fontSize: 28,
          fontStyle: "italic",
          letterSpacing: "-0.02em",
          fontWeight: 400,
        }}
      >
        {isPaginated ? "Nothing older to show" : "All caught up."}
      </h2>
      <p className="mt-2 text-body text-ink-subtle max-w-[420px] mx-auto">
        {isPaginated
          ? "You've reached the bottom of the timeline."
          : "New activity on your tasks will appear here."}
      </p>
      {isPaginated && (
        <Link
          href={"/inbox" as Route}
          className="mt-6 inline-block text-body text-altus-red hover:underline underline-offset-4"
        >
          ← Back to latest
        </Link>
      )}
    </div>
  );
}
