/**
 * What a task or an Action is CALLED on screen: its description when it has
 * one, otherwise its name/title so the label is never blank.
 *
 * Display only. `tasks.title` / `project_nodes.name` stay the stored identity
 * (and what the plan ↔ task sync copies), and the rename inputs keep editing
 * those — this never feeds a write, a search or a sort.
 *
 * Client-safe: no DB, no React.
 */
export function describedLabel(
  description: string | null | undefined,
  name: string,
): string {
  const d = description?.replace(/\s+/g, " ").trim();
  return d ? d : name;
}
