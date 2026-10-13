import { redirect } from "next/navigation";
import type { Route } from "next";
import { EXIT_SECTIONS, exitHref } from "@/lib/hr/exit";

/** The group has no page of its own; it opens on its first section. */
export default function ExitIndex() {
  redirect(exitHref(EXIT_SECTIONS[0]!.slug) as Route);
}
