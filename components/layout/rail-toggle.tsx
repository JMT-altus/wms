"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { setRailCollapsed, useRailCollapsed } from "./rail-collapse";

/**
 * The collapse control shared by all three rails. Sits on the navy panel, so
 * it is styled against white rather than the app's ink tokens.
 */
export function RailToggle({ className }: { className?: string }) {
  const collapsed = useRailCollapsed();
  return (
    <button
      type="button"
      onClick={() => setRailCollapsed(!collapsed)}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={`grid place-items-center rounded-lg size-8 shrink-0 text-white/60 hover:text-white transition-colors ${className ?? ""}`}
      style={{ border: "1px solid rgba(255,255,255,0.14)" }}
    >
      {collapsed ? (
        <PanelLeftOpen size={16} strokeWidth={2.2} />
      ) : (
        <PanelLeftClose size={16} strokeWidth={2.2} />
      )}
    </button>
  );
}
