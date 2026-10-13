import { redirect } from "next/navigation";
import type { Route } from "next";
import { APPRAISAL_LETTER_SECTIONS, appraisalLetterHref } from "@/lib/hr/appraisal-letters";

/** The group has no page of its own; it opens on its first section. */
export default function AppraisalLettersIndex() {
  redirect(appraisalLetterHref(APPRAISAL_LETTER_SECTIONS[0]!.slug) as Route);
}
