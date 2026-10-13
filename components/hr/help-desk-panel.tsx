"use client";

import * as React from "react";
import { LifeBuoy, Plus, TicketCheck } from "lucide-react";

/**
 * HR Help Desk — UI only.
 *
 * No ticket backend exists yet, so the list is the empty state and the form
 * cannot be submitted: Submit is disabled and says why, rather than claiming
 * anything was sent. The category is free text because the list of categories
 * (like SLAs, routing and approvals) is for the company to decide and configure
 * later. No attachment field: there is no ticket storage to put one in.
 */

const LINE = "#E8E5DF";
const FIELD =
  "mt-1 w-full rounded-md border border-hairline bg-surface-card py-2.5 px-3.5 text-[14px] text-ink-strong";

export function HelpDeskPanel() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="grid gap-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">HR</div>
          <h1 className="mt-1 text-[26px] font-bold text-ink-strong">HR Help Desk</h1>
          <p className="mt-1 text-[14px] text-ink-muted max-w-2xl">
            Raise a question or request with HR and follow it here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 h-10 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: "linear-gradient(135deg, #D946EF, #A21CAF)" }}
        >
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Raise a Ticket
        </button>
      </header>

      {open && (
        <form
          onSubmit={(e) => e.preventDefault()}
          aria-label="Raise a ticket"
          className="rounded-2xl bg-white p-6 max-md:p-4"
          style={{ border: `1px solid ${LINE}` }}
        >
          <h2 className="text-[16px] font-bold text-ink-strong">Raise a Ticket</h2>
          <div className="mt-3 grid gap-3 max-w-xl">
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">Subject</span>
              <input name="subject" type="text" maxLength={200} className={FIELD} />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">Category</span>
              <input name="category" type="text" maxLength={80} className={FIELD} />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">Description</span>
              <textarea name="description" rows={5} className={FIELD} />
            </label>
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled
              aria-disabled="true"
              className="rounded-lg px-5 h-10 text-[14px] font-semibold cursor-not-allowed"
              style={{ background: "#EEF0F3", color: "#8A93A0" }}
            >
              Submit
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-5 h-10 text-[14px] font-semibold text-ink-strong hover:bg-[#F3F1EC]"
              style={{ border: `1px solid ${LINE}` }}
            >
              Cancel
            </button>
            <span className="text-[12.5px] text-ink-subtle">
              Ticket submission is not connected yet, so nothing can be sent from here.
            </span>
          </div>
        </form>
      )}

      <section
        aria-label="My tickets"
        className="rounded-2xl bg-white px-6 py-16 max-md:py-12 text-center"
        style={{ border: `1px solid ${LINE}`, minHeight: 320 }}
      >
        <span className="inline-grid place-items-center text-ink-subtle" aria-hidden>
          {open ? <LifeBuoy size={34} strokeWidth={1.6} /> : <TicketCheck size={34} strokeWidth={1.6} />}
        </span>
        <h2 className="mt-3 text-[16px] font-bold text-ink-strong">No tickets yet</h2>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          Tickets you raise with HR will be listed here.
        </p>
      </section>
    </div>
  );
}
