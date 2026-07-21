// Disabled for JMT Drive Solutions — the dashboard starts with empty data.
// Admin populates employees, departments, and tasks via /admin/* in the UI.
//
// If you ever want demo/dev data back, restore from git history (commit prior
// to the JMT Drive Solutions rebrand) or write a fresh fixture set tailored to
// JMT Drive Solutions's actual departments.

console.log("Seed disabled — JMT Drive Solutions starts with empty data.");
console.log("Bootstrap your first admin:");
console.log('  pnpm bootstrap-admin -- --email mihir.jmtds@gmail.com --name "Mihir Veera"');
console.log("Then add employees and tasks via /admin/* in the UI.");
process.exit(0);
