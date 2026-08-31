import { describe, expect, it, vi } from "vitest";

// `lib/db/retry.ts` starts with `import "server-only"`, which throws outside
// an RSC. Same no-op mock the other server-module tests use.
vi.mock("server-only", () => ({}));

const { withDbRetry, allWithDbRetry } = await import("@/lib/db/retry");

/**
 * Builds the exact error shape postgres-js produced in the dev log: drizzle's
 * "Failed query: ..." wrapper with the driver's real error as `cause`.
 */
function pgError(code: string, message: string) {
  const e = new Error('Failed query: select "id", "name" from "designations"') as Error & {
    cause?: unknown;
  };
  e.cause = Object.assign(new Error(message), { code });
  return e;
}

describe("withDbRetry", () => {
  it("recovers from 57014, the statement-timeout kill that broke the KYC page", async () => {
    let calls = 0;
    const result = await withDbRetry("designations", async () => {
      calls++;
      if (calls === 1) throw pgError("57014", "canceling statement due to statement timeout");
      return "rows";
    });
    expect(result).toBe("rows");
    expect(calls).toBe(2);
  });

  it("recovers from a dead socket", async () => {
    let calls = 0;
    const result = await withDbRetry("lookups", async () => {
      calls++;
      if (calls < 3) throw pgError("", "read ECONNRESET");
      return "rows";
    });
    expect(result).toBe("rows");
    expect(calls).toBe(3);
  });

  it("does NOT retry a real bug — a bad column surfaces on the first attempt", async () => {
    let calls = 0;
    await expect(
      withDbRetry("bad column", async () => {
        calls++;
        throw pgError("42703", 'column "nope" does not exist');
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("gives up rather than looping forever when the fault persists", async () => {
    let calls = 0;
    await expect(
      withDbRetry("always down", async () => {
        calls++;
        throw pgError("57014", "canceling statement due to statement timeout");
      }),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });
});

describe("allWithDbRetry", () => {
  it("retries only the flaky read, leaving the healthy ones alone", async () => {
    const runs: [number, number, number] = [0, 0, 0];
    const out = await allWithDbRetry([
      [
        "a",
        async () => {
          runs[0]++;
          return 1;
        },
      ],
      [
        "b",
        async () => {
          runs[1]++;
          if (runs[1] === 1) {
            throw pgError("57014", "canceling statement due to statement timeout");
          }
          return 2;
        },
      ],
      [
        "c",
        async () => {
          runs[2]++;
          return 3;
        },
      ],
    ] as const);

    expect(out).toEqual([1, 2, 3]);
    // The whole point of retrying per-read rather than per-batch.
    expect(runs).toEqual([1, 2, 1]);
  });
});
