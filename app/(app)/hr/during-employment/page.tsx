import { redirect } from "next/navigation";
import type { Route } from "next";
import { DURING_EMPLOYMENT_SECTIONS, duringEmploymentHref } from "@/lib/hr/during-employment";

/** The group has no page of its own; it opens on its first section. */
export default function DuringEmploymentIndex() {
  redirect(duringEmploymentHref(DURING_EMPLOYMENT_SECTIONS[0]!.slug) as Route);
}
