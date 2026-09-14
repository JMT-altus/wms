import { PlanPage } from "../plan-page";

export const dynamic = "force-dynamic";

/**
 * The board.
 *
 * THE SAME PAGE, opened on the kanban — not a second screen with its own data.
 * Sharing the page means sharing the tree, the search, the project filter and
 * the level pill.
 */
export default function Page() {
  return <PlanPage level="actions" initialView="kanban" />;
}
