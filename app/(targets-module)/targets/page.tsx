import { redirect } from "next/navigation";
import type { Route } from "next";

/** No separate overview — the annual screen is where a year starts. */
export default function TargetsIndexPage() {
  redirect("/targets/annual" as Route);
}
