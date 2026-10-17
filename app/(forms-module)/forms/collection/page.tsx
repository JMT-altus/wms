import { redirect } from "next/navigation";
import type { Route } from "next";

/** The Collection section opens on its dashboard. */
export default function CollectionIndex() {
  redirect("/forms/collection/dashboard" as Route);
}
