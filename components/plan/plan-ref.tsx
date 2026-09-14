import * as React from "react";

/**
 * A row's reference — P1, M2, RA, A1, SA3.1, SSA3.1.1.
 *
 * ONE component, used by the registers, the hierarchy table and Project Views.
 * The ref is the label people quote to each other, so it has to look identical
 * wherever it appears; three hand-styled copies drifted the first time one of
 * them was tweaked, which is the whole reason this file exists.
 *
 * A quiet grey chip with near-black text: the ref is an identifier, not a
 * status, and colouring it would imply it meant something it does not. The
 * chip is what separates it from the name beside it.
 *
 * The value itself is always DERIVED (`refFor`) and never stored — see
 * lib/plan/levels.ts.
 */
export function PlanRef({
  children,
  title,
  size = 11,
  tone = "red",
}: {
  children: React.ReactNode;
  /** The full ref, so hovering a row gives the whole traceability path. */
  title?: string;
  size?: number;
  /**
   * "red" on a plan row, where the ref is the row's identity and the thing
   * people quote. "grey" where it is incidental — a keycap, a dialog header.
   */
  tone?: "red" | "grey";
}) {
  return (
    <span
      className={tone === "red" ? "plan-chip plan-chip--red" : "plan-chip"}
      title={title}
      style={{ fontSize: size }}
    >
      {children}
    </span>
  );
}
