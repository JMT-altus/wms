import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import { canonical, inputsHash, resultHash } from "@/lib/incentives/category-a/hash";
import { ENGINE_VERSION, type CategoryAInput } from "@/lib/incentives/category-a/types";
import { categoryAScenarios } from "../fixtures/golden/category-a-scenarios";

/**
 * Category A GOLDEN MASTER (engine level). The snapshot was captured from the Category A engine BEFORE any Category B
 * work touched it, and holds, per scenario, the exact input, its input hash, the full result and the result hash.
 *
 * Every later change must leave all of them byte-for-byte identical:
 *   * the engine re-run on each STORED input gives exactly the stored result (canonical JSON) and hashes;
 *   * the scenario builders still produce exactly the stored inputs (so the fixtures didn't drift either);
 *   * the engine version is category-a/2.
 *
 * Regenerating the snapshot (GOLDEN_WRITE=1) is only ever done for a deliberate engine version change, never to make a
 * failing comparison pass. category-a/1 → category-a/2 (2026-11-21) was regenerated after a scenario-by-scenario
 * comparison with the stored category-a/1 results: NO amount changed in any scenario. The differences were exactly the
 * intended ones — every hold carries a code; an order credited to nobody because something is missing is held
 * ("unassigned") instead of only listed as left out; "settled" is false while anything is held; an ignored credit note
 * explains its consequence; and the bounce scenario uses "Reverse what it earned" (Category A no longer offers "restart
 * the delay", which gave exactly the same figures — confirmed by that comparison).
 */
const FILE = resolve(__dirname, "../fixtures/golden/category-a-engine.json");
interface Golden {
  engineVersion: string;
  scenarios: { name: string; input: CategoryAInput; inputsHash: string; resultHash: string; result: unknown }[];
}

if (process.env.GOLDEN_WRITE === "1") {
  const scenarios = categoryAScenarios().map(({ name, input }) => {
    const result = calculateCategoryA(input);
    return { name, input, inputsHash: inputsHash(input), resultHash: resultHash(result), result };
  });
  if (!existsSync(dirname(FILE))) mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify({ engineVersion: ENGINE_VERSION, scenarios } satisfies Golden)}\n`);
}

const golden = JSON.parse(readFileSync(FILE, "utf8")) as Golden;

describe("Category A golden master — engine", () => {
  it("is engine category-a/2, with every scenario present", () => {
    expect(ENGINE_VERSION).toBe("category-a/2");
    expect(golden.engineVersion).toBe("category-a/2");
    expect(golden.scenarios.map((s) => s.name)).toEqual(categoryAScenarios().map((s) => s.name));
    expect(golden.scenarios.length).toBeGreaterThanOrEqual(60);
  });
  it("covers both April examples exactly: ₹1,083.33 and ₹925.00", () => {
    const pay = (name: string) => (golden.scenarios.find((s) => s.name === name)!.result as { employees: { payablePaise: number }[] }).employees[0]!.payablePaise;
    expect(pay("april example 1 (₹1,083.33)")).toBe(108_333);
    expect(pay("april example 2 (₹925.00)")).toBe(92_500);
  });
  for (const s of golden.scenarios) {
    it(`unchanged: ${s.name}`, () => {
      // The stored input still hashes the same, and the engine still gives exactly the stored result.
      expect(inputsHash(s.input)).toBe(s.inputsHash);
      const again = calculateCategoryA(s.input);
      expect(canonical(again)).toBe(canonical(s.result));
      expect(resultHash(again)).toBe(s.resultHash);
    });
  }
  it("the scenario builders still give exactly the stored inputs", () => {
    const now = categoryAScenarios();
    for (const [i, s] of golden.scenarios.entries()) expect(inputsHash(now[i]!.input), s.name).toBe(s.inputsHash);
  });
});
