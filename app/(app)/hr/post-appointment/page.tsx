import { redirect } from "next/navigation";
import type { Route } from "next";
import { POST_APPOINTMENT_SECTIONS, postAppointmentHref } from "@/lib/hr/post-appointment";

/** The group has no page of its own; it opens on its first section. */
export default function PostAppointmentIndex() {
  redirect(postAppointmentHref(POST_APPOINTMENT_SECTIONS[0].slug) as Route);
}
