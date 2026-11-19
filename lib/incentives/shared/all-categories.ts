import { rupees } from "@/lib/incentives/rules-config/validate";

/**
 * Sharing the all-categories monthly limit ("Most a salesperson can earn from all categories in a month") between the
 * categories the WMS calculates — PURE, shared by the engines. No category has priority of its own: the published
 * policy decides ("Sharing the all-categories limit between categories"):
 *   proportional  — each category keeps its share of the limit left, in proportion to its own amount, rounded DOWN to
 *                   the paisa; the paise left over by rounding go one at a time to the largest remainders (ties: by
 *                   category code), so the shares add up to the limit and never exceed it;
 *   categoryOrder — the categories are filled one after another in the order chosen; a category missing from the order
 *                   comes after those listed (by code).
 * A category whose month is locked, submitted, approved or paid ("fixed") keeps its own figure, which is never changed;
 * the other categories share what is left of the limit.
 */

export interface OtherCategoryAmount {
  category: string;
  /** The category's amount before the all-categories limit (after its own monthly limit). */
  prePaise: number;
  /** What the category's adopted calculation gives after the all-categories limit. */
  finalPaise: number;
  /** Its month is locked, submitted, approved or paid: its figure stands. */
  fixed: boolean;
}

export interface AllCategoriesIn {
  /** The limit (paise), or null for "No limit". */
  capPaise: number | null;
  policy: "proportional" | "categoryOrder";
  order: string[];
  /** The other categories' amounts this month, per employee id. */
  others: Record<string, OtherCategoryAmount[]>;
  /** Why the limit can't be applied (the categories' versions disagree), or absent. */
  problem?: string;
}

export function allCategoriesAllowance(args: { capPaise: number | null; policy: string; order: readonly string[]; own: string; ownPrePaise: number; others: readonly OtherCategoryAmount[] }): { allowedPaise: number; note: string | null } {
  const { capPaise, own, ownPrePaise } = args;
  if (capPaise === null) return { allowedPaise: ownPrePaise, note: null };
  const fixed = args.others.filter((o) => o.fixed);
  const fixedTotal = fixed.reduce((a, o) => a + Math.max(0, o.finalPaise), 0);
  const remaining = Math.max(0, capPaise - fixedTotal);
  const open = [{ category: own, pre: Math.max(0, ownPrePaise) }, ...args.others.filter((o) => !o.fixed).map((o) => ({ category: o.category, pre: Math.max(0, o.prePaise) }))];
  const total = open.reduce((a, o) => a + o.pre, 0);
  const fixedNote = fixed.length ? ` after ${fixed.map((o) => `Category ${o.category}'s ${rupees(o.finalPaise)} (fixed)`).join(", ")}` : "";
  if (total <= remaining) return { allowedPaise: ownPrePaise, note: null };
  let allowed: number;
  if (args.policy === "categoryOrder") {
    const listed = args.order.filter((c) => open.some((o) => o.category === c));
    const rest = open.map((o) => o.category).filter((c) => !listed.includes(c)).sort();
    let left = remaining;
    allowed = 0;
    for (const c of [...listed, ...rest]) {
      const pre = open.find((o) => o.category === c)!.pre;
      const take = Math.min(pre, left);
      left -= take;
      if (c === own) allowed = take;
    }
    return { allowedPaise: allowed, note: `Limited by the all-categories limit of ${rupees(capPaise)}${fixedNote}: categories filled in the order ${[...listed, ...rest].join(", ")} — ${rupees(allowed)} for Category ${own}.` };
  }
  // Proportional, exact in integers: floor shares, then the leftover paise by largest remainder (ties by code).
  const R = BigInt(remaining), T = BigInt(total);
  const shares = open.map((o) => ({ category: o.category, base: (R * BigInt(o.pre)) / T, rem: (R * BigInt(o.pre)) % T }));
  let leftover = R - shares.reduce((a, x) => a + x.base, 0n);
  for (const x of [...shares].sort((a, b) => (a.rem === b.rem ? (a.category < b.category ? -1 : 1) : a.rem > b.rem ? -1 : 1))) {
    if (leftover <= 0n) break;
    x.base += 1n;
    leftover -= 1n;
  }
  allowed = Number(shares.find((x) => x.category === own)!.base);
  return { allowedPaise: allowed, note: `Limited by the all-categories limit of ${rupees(capPaise)}${fixedNote}: shared in proportion to each category's amount — ${rupees(allowed)} for Category ${own}.` };
}
