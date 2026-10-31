import { redirect } from "next/navigation";
import type { Route } from "next";

/** The Collection section opens on its dashboard. */
export default function CollectionIndex() {
  redirect("/collection/dashboard" as Route);
}
