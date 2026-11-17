/**
 * Exact fractions of a paisa (bigint numerator / denominator), so no incentive amount is ever a floating-point
 * approximation. An amount is rounded only where the configuration's "Where rounding happens" says, and only by the
 * configured method and precision (round()).
 */
export interface Q {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let N = BigInt(n), D = BigInt(d);
  if (D === 0n) throw new Error("Division by zero in an incentive amount.");
  if (D < 0n) [N, D] = [-N, -D];
  const g = gcd(N, D);
  return { n: N / g, d: D / g };
}

export const ZERO = q(0);
export const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const cmp = (a: Q, b: Q) => {
  const x = a.n * b.d, y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
};
export const min = (a: Q, b: Q) => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Q, b: Q) => (cmp(a, b) >= 0 ? a : b);
export const sum = (xs: readonly Q[]) => xs.reduce(add, ZERO);
export const isZero = (a: Q) => a.n === 0n;
/** Parts per million as a fraction (1,000,000 ppm = 1). */
export const ppm = (p: number) => q(p, 1_000_000);
/** "n/d" — how an exact amount is stored and shown in the audit. */
export const text = (a: Q) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
export const fromText = (s: string) => {
  const [n, d] = s.split("/");
  return q(BigInt(n!), BigInt(d ?? "1"));
};

export type RoundingMethod = "halfUp" | "halfEven" | "down" | "up";
export type RoundingPrecision = "paise" | "rupee" | "tenRupees";
const UNIT: Record<RoundingPrecision, bigint> = { paise: 1n, rupee: 100n, tenRupees: 1000n };

/** An exact amount (in paise) rounded to whole paise at the configured precision and method. Amounts here are ≥ 0, but negatives are handled symmetrically. */
export function round(a: Q, method: RoundingMethod, precision: RoundingPrecision): number {
  const unit = UNIT[precision];
  const neg = a.n < 0n;
  const n = neg ? -a.n : a.n;
  const d = a.d * unit;
  let whole = n / d;
  const rem = n % d;
  if (rem !== 0n) {
    const twice = rem * 2n;
    if (method === "up") whole += 1n;
    else if (method === "halfUp") whole += twice >= d ? 1n : 0n;
    else if (method === "halfEven") whole += twice > d || (twice === d && whole % 2n === 1n) ? 1n : 0n;
  }
  const out = Number(whole * unit);
  return neg ? -out : out;
}
