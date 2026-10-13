// Store the JMT Drive Solutions Holiday List 2026 in the `holidays` table.
//
// Source of truth: lib/attendance/holiday-list-2026.ts (the published list).
// Eid Ul Fitr is NOT stored — the list gives two possible dates and the table
// has no tentative state; add it from /admin/holidays once the date is confirmed.
//
// Safe to re-run: a date that already has a holiday is left exactly as it is
// (no overwrite, no duplicate). Needs migration 0107 (the `is_optional` column).
// Before writing it also re-checks every weekday printed on the list against the
// calendar and refuses to continue on a mismatch, rather than quietly "fixing"
// the official list.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/seed-holidays-2026.ts          # dry run
//   pnpm tsx --env-file=.env.local scripts/seed-holidays-2026.ts --apply
import postgres from "postgres";
import {
  HOLIDAYS_2026,
  HOLIDAYS_PENDING_CONFIRMATION,
} from "../lib/attendance/holiday-list-2026";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const sql = postgres(url, { max: 1, prepare: false });

const weekdayOf = (ymd: string): string =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

async function main() {
  console.log(`\n=== Holiday list 2026 — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);

  // 1. The list's own weekdays must agree with the calendar.
  const wrong = [
    ...HOLIDAYS_2026.map((h) => ({ date: h.date, label: h.label, weekday: h.weekday })),
    ...HOLIDAYS_PENDING_CONFIRMATION.flatMap((h) =>
      h.candidates.map((c) => ({ date: c.date, label: h.label, weekday: c.weekday })),
    ),
  ].filter((h) => weekdayOf(h.date) !== h.weekday);
  if (wrong.length > 0) {
    for (const w of wrong) {
      console.error(`MISMATCH ${w.date} ${w.label}: list says ${w.weekday}, calendar says ${weekdayOf(w.date)}`);
    }
    throw new Error("Weekday check failed — nothing was written. Confirm the list before seeding.");
  }
  console.log(`weekday check: all ${HOLIDAYS_2026.length} dates match the list's weekdays`);

  // 2. The column must exist.
  const col = await sql`
    select 1 from information_schema.columns
     where table_name = 'holidays' and column_name = 'is_optional'`;
  if (col.length === 0) throw new Error("holidays.is_optional is missing — apply migration 0107 first.");

  // 3. Insert what is not already there.
  const existing = await sql<{ holiday_date: string }[]>`select holiday_date::text from holidays`;
  const have = new Set(existing.map((r) => r.holiday_date));
  let added = 0;
  let skipped = 0;
  for (const h of HOLIDAYS_2026) {
    if (have.has(h.date)) {
      skipped++;
      console.log(`  skip   ${h.date}  ${h.label}  (a holiday already exists on this date)`);
      continue;
    }
    console.log(`  ${APPLY ? "add " : "would add"} ${h.date}  ${h.weekday.padEnd(9)} ${h.label}${h.optional ? "  [optional]" : ""}`);
    if (APPLY) {
      await sql`
        insert into holidays (holiday_date, label, is_active, is_optional)
        values (${h.date}, ${h.label}, true, ${h.optional})
        on conflict (holiday_date) do nothing`;
    }
    added++;
  }
  for (const p of HOLIDAYS_PENDING_CONFIRMATION) {
    console.log(`  HOLD   ${p.candidates.map((c) => c.date).join(" or ")}  ${p.label}  (date needs confirmation — not stored)`);
  }
  console.log(`\n${APPLY ? "added" : "would add"} ${added}, skipped ${skipped}, held 1`);
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
