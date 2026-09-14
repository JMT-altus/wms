import { PlanPage } from "./plan-page";

export const dynamic = "force-dynamic";

/** Projects — the module root. The sidebar marks this item `exact`, or every
 *  child route would light it up too. */
export default function Page() {
  return <PlanPage level="projects" />;
}
