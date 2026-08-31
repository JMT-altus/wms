import "server-only";

/**
 * Retry a READ that failed for a transient reason.
 *
 * ── Why this exists ──
 *
 * The remote pool is not reliably reachable from every network this app runs
 * on. Two observed failure shapes, both transient, both fatal to a page:
 *
 *  1. The socket dies without a FIN — `ECONNRESET`, or `ENOTFOUND` when the
 *     pooler's hostname briefly stops resolving.
 *  2. A query stalls on a wedged connection until Postgres kills it at its
 *     own `statement_timeout` (2 minutes on this pooler) and returns `57014`.
 *     postgres-js pipelines, so every other query queued on that connection
 *     fails with the same error — which is how one bad connection turned a
 *     page's seven-query fan-out into "We hit a snag".
 *
 * A second attempt on a fresh connection succeeds in essentially every one of
 * these cases, because the fault is the connection, not the query. Measured
 * against this database, the seven queries behind the KYC form run in ~11ms
 * once warm — there is nothing slow here to be patient about.
 *
 * ── Reads only, deliberately ──
 *
 * Retrying a single cancelled SELECT is safe: it produced nothing and changed
 * nothing. A write is a different question — a statement that timed out may
 * or may not have been part of a transaction that partly applied, and blindly
 * re-running it can duplicate work. Writes therefore keep their existing
 * behaviour of surfacing the error to the caller, which the actions already
 * turn into a message rather than a crash.
 *
 * Do NOT reach for this to paper over a genuinely slow query. It retries the
 * same work; if the work itself is the problem, this makes it worse.
 */

/** Driver/socket-level faults. Matched on message because the driver wraps them. */
const TRANSIENT_TEXT = /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EPIPE|EHOSTUNREACH/i;

/**
 * Postgres SQLSTATEs worth a second attempt:
 *   57014  query_canceled — the statement_timeout kill described above
 *   57P01  admin_shutdown — the backend was terminated
 *   08006  connection_failure
 *   08003  connection_does_not_exist
 *   08000  connection_exception
 *   53300  too_many_connections — the pooler was momentarily saturated
 */
const TRANSIENT_CODES = new Set(["57014", "57P01", "08006", "08003", "08000", "53300"]);

function isTransient(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e?.cause?.code && TRANSIENT_CODES.has(e.cause.code)) return true;
  return TRANSIENT_TEXT.test(`${e?.message ?? ""} ${e?.cause?.message ?? ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withDbRetry<T>(
  /** Shows up in the log when a retry happens; name the read, not the table. */
  label: string,
  run: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      // A real error — a bad column, a type mismatch — must surface on the
      // first attempt. Retrying it just delays the report by half a second.
      if (!isTransient(err) || attempt === attempts) throw err;
      const backoff = attempt * 150;
      console.warn(
        `[withDbRetry] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${backoff}ms`,
        (err as Error)?.message?.slice(0, 120),
      );
      await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * Run several independent reads together, retrying each on its own.
 *
 * `Promise.all` over retried reads is not the same as retrying the whole
 * batch: one flaky query should not re-run the six that already succeeded.
 */
export function allWithDbRetry<
  const T extends readonly (readonly [string, () => Promise<unknown>])[],
>(reads: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K][1]>> }> {
  return Promise.all(
    reads.map(([label, run]) => withDbRetry(label, run)),
  ) as Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K][1]>> }>;
}
