"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
      style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)" }}
    >
      <Printer size={14} aria-hidden /> Print
    </button>
  );
}
