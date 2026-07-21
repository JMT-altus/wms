// One-off: set every employee's accent to the JMT blue (rows created before the
// default changed still carry the old red). Read-write, idempotent.
import postgres from "postgres";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const sql = postgres(url, { max: 1, prepare: false });
async function main() {
  const rows = await sql`update employees set accent = '#0A6CFF' where accent is distinct from '#0A6CFF' returning email, accent`;
  console.log(`Updated ${rows.length} employee accent(s) to #0A6CFF:`);
  for (const r of rows) console.log(`  ${r.email} -> ${r.accent}`);
  await sql.end();
}
main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
