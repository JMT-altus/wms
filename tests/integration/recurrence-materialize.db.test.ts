import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) of the recurrence materializer, the part that actually creates the tasks. Each test
// saves a template with the rule the picker writes, then runs the real materializer once per day, as the daily cron does.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let run: (typeof import("@/lib/recurrence/materialize"))["materializeRecurringTasks"];
let emp = "";

async function template(dueYmd: string, rule: string, recurrence = "monthly") {
  const r = await pg.query<{ id: string }>(
    `insert into tasks (title, doer_id, initiator_id, created_by_id, due_at, priority, status, recurrence, recurrence_rule, short_id)
     values ('Monthly report', $1, $1, $1, $2, 'imp_urgent', 'not_started', $3, $4, $5) returning id`,
    [emp, `${dueYmd}T12:00:00.000Z`, recurrence, rule, `T-${Math.random().toString(36).slice(2, 9)}`],
  );
  return r.rows[0]!.id;
}
/** The daily cron, every day from `from` to `to` inclusive. */
async function everyDay(from: string, to: string) {
  for (let t = Date.parse(`${from}T02:00:00Z`); t <= Date.parse(`${to}T02:00:00Z`); t += 86_400_000) await run({ now: new Date(t) });
}
const dates = async (id: string) => (await pg.query<{ d: string }>(`select recurrence_occurrence_date d from tasks where recurrence_parent_id = $1 order by 1`, [id])).rows.map((r) => r.d);

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, tasks: schema.tasks, taskEvents: schema.taskEvents });
  pg = made.pg;
  h.db = made.db;
  await pg.exec("create unique index tasks_recurrence_dedup_idx on tasks(recurrence_parent_id, recurrence_occurrence_date)"); // migration 0032
  emp = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Asha', 'asha@example.test', 'both') returning id`)).rows[0]!.id;
  run = (await import("@/lib/recurrence/materialize")).materializeRecurringTasks;
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec("delete from task_events; delete from tasks");
});

describe("tasks are really created", () => {
  it("every month, carrying the due time and no rule of their own", async () => {
    const id = await template("2026-11-05", "FREQ=MONTHLY;BYMONTHDAY=5");
    await everyDay("2026-11-05", "2027-01-05");
    expect(await dates(id)).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
    const kids = await pg.query<{ due: string; rule: string | null }>(`select to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') due, recurrence_rule rule from tasks where recurrence_parent_id = $1 order by 1`, [id]);
    expect(kids.rows[0]).toEqual({ due: "2026-12-05 12:00", rule: null });
  });

  it("every 2 months", async () => {
    const id = await template("2026-11-15", "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15");
    await everyDay("2026-11-15", "2027-03-15");
    expect(await dates(id)).toEqual(["2027-01-15", "2027-03-15", "2027-05-15"]);
  });

  it("from 31 January: the last available day, and back to the 31st — one tick after another, with no drift", async () => {
    const id = await template("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=31");
    await everyDay("2026-01-31", "2026-04-30");
    expect(await dates(id)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("a rule naming no day doesn't drift to the 28th either", async () => {
    const id = await template("2026-01-31", "FREQ=MONTHLY");
    await everyDay("2026-01-31", "2026-03-31");
    expect(await dates(id)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("a leap February", async () => {
    const id = await template("2028-01-31", "FREQ=MONTHLY;BYMONTHDAY=31");
    await everyDay("2028-01-31", "2028-02-29");
    expect(await dates(id)).toEqual(["2028-02-29", "2028-03-31"]);
  });

  it("stops at the end date", async () => {
    const id = await template("2026-11-05", "FREQ=MONTHLY;BYMONTHDAY=5;UNTIL=2027-01-05");
    await everyDay("2026-11-05", "2027-03-06");
    expect(await dates(id)).toEqual(["2026-12-05", "2027-01-05"]);
  });

  it("stops after N occurrences, the template being the first", async () => {
    const id = await template("2026-11-05", "FREQ=MONTHLY;BYMONTHDAY=5;COUNT=3");
    await everyDay("2026-11-05", "2027-03-06");
    expect(await dates(id)).toEqual(["2026-12-05", "2027-01-05"]);
  });

  it("weekly on several days, and a weekly series with an interval", async () => {
    const a = await template("2026-11-02", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "weekly");
    const b = await template("2026-11-02", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "weekly");
    await everyDay("2026-11-02", "2026-11-16");
    expect(await dates(a)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18"]);
    expect(await dates(b)).toEqual(["2026-11-16", "2026-11-30"]);
  });

  it("an interval longer than a year still finds its next date", async () => {
    const a = await template("2026-11-05", "FREQ=MONTHLY;INTERVAL=18;BYMONTHDAY=5");
    await everyDay("2026-11-05", "2026-11-05");
    expect(await dates(a)).toEqual(["2028-05-05"]);
  });

  it("running twice creates nothing twice", async () => {
    const id = await template("2026-11-05", "FREQ=MONTHLY;BYMONTHDAY=5");
    await everyDay("2026-11-05", "2026-11-05");
    await everyDay("2026-11-05", "2026-11-05");
    expect(await dates(id)).toEqual(["2026-12-05"]);
  });
});
