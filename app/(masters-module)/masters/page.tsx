import { redirect } from "next/navigation";
import type { Route } from "next";

/**
 * The module has no overview screen of its own — landing on an empty summary
 * before you can do anything is a click tax. `/masters` opens the first master
 * instead; the rail makes the rest obvious.
 */
export default function MastersIndexPage() {
  redirect("/masters/products" as Route);
}
