// Public surface of the incentive rule engine.
export * from "./types";
export { evaluate } from "./engine";
export { applyCaps } from "./caps";
export { decayMultiplier, decayLabel } from "./collection";
export { collectAccruals } from "./rules";
export { SALES_BH_SCHEME, P, L, CR } from "./config";
