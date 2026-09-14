// One-off: archive the tasks that used to hang off a RESULT.
//
// A Result no longer gets a task of its own (TASK_KINDS), so these are
// orphans — `syncNodeTask` will never touch them again and they sit in the
// list beside the Action that describes the same work.
//
// ARCHIVE, never delete: archiving is reversible from the recycle bin, and a
// row nobody can get back is not a cleanup, it is a loss. And it REFUSES any
// task that carries real work — a comment or a tracked second means somebody
// used it, and that is a decision for a person, not a script.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const sql = postgres(url, { max: 1, prepare: false });

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = (await sql.unsafe(`
    select
      t.id, t.task_no, t.title, t.status, n.name as result_name,
      (select count(*)::int from task_events e
        where e.task_id = t.id and e.event_type = 'commented')  as comments,
      (select coalesce(sum(r.total_seconds), 0)::int from task_time_rollup r
        where r.task_id = t.id)                                  as tracked_seconds
      from tasks t
      join project_nodes n on n.id = t.project_node_id
     where t.archived = false and n.kind = 'result'
     order by t.created_at
  `)) as unknown as {
    id: string;
    task_no: number;
    title: string;
    status: string;
    result_name: string;
    comments: number;
    tracked_seconds: number;
  }[];

  const empty = rows.filter((r) => r.comments === 0 && r.tracked_seconds === 0);
  const used = rows.filter((r) => r.comments > 0 || r.tracked_seconds > 0);

  console.log(`\n=== tasks hanging off a Result: ${rows.length} ===`);
  for (const r of rows) {
    const mark = r.comments > 0 || r.tracked_seconds > 0 ? "KEPT (carries work)" : "archive";
    console.log(
      `  #${r.task_no} "${r.title}" [${r.status}] — comments ${r.comments}, tracked ${r.tracked_seconds}s → ${mark}`,
    );
  }

  if (used.length > 0) {
    console.log(
      `\n! ${used.length} task(s) carry comments or tracked time and were left alone. Decide those by hand.`,
    );
  }
  if (empty.length === 0) {
    console.log("\nNothing to archive.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run — re-run with --apply to archive ${empty.length}.`);
    return;
  }

  const ids = empty.map((r) => r.id);
  await sql.unsafe(
    `update tasks set archived = true, updated_at = now() where id = any($1::uuid[])`,
    [ids],
  );
  console.log(`\n✓ Archived ${ids.length}. Recoverable from the recycle bin.`);
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
