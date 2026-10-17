"use client";

import { useTransition } from "react";
import { markAllNotificationsRead } from "./actions";
import { fireToast } from "@/lib/toast";

interface Props {
  hasUnread: boolean;
}

/**
 * "Mark all read" button at the top of /inbox.  Disabled when there's
 * nothing to mark.  Pure progressive enhancement — the server action
 * does its own auth + scope checks.
 */
export function MarkAllButton({ hasUnread }: Props) {
  const [isPending, startTransition] = useTransition();
  const disabled = !hasUnread || isPending;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        startTransition(async () => {
          const res = await markAllNotificationsRead();
          if (!res.ok) fireToast({ message: res.error });
        });
      }}
      className="inline-flex h-8 items-center rounded-lg border border-[#D3E2FB] bg-[#EEF4FF] px-3 text-[13px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD] hover:border-[#B8CCEE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF] disabled:cursor-not-allowed disabled:border-hairline disabled:bg-[#F5F7FB] disabled:text-ink-subtle disabled:opacity-70 disabled:hover:bg-[#F5F7FB]"
    >
      {isPending ? "Marking…" : "Mark all read"}
    </button>
  );
}
