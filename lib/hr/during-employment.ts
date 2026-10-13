/**
 * HR → During Employment: the sections, in the order they are listed.
 *
 * Structure only — same shape as Post-Appointment. `existingHref` marks a
 * section whose real feature already lives elsewhere, so its placeholder points
 * there instead of pretending to duplicate it.
 */
export const DURING_EMPLOYMENT_BASE = "/hr/during-employment";

export const DURING_EMPLOYMENT_SECTIONS: ReadonlyArray<{
  slug: string;
  label: string;
  existingHref?: string;
}> = [
  { slug: "declaration-status", label: "Declaration Status" },
  { slug: "induction", label: "Induction", existingHref: "/training/induction" },
  { slug: "employee-of-the-month", label: "Employee of the Month" },
  { slug: "birthday", label: "Birthday" },
  { slug: "work-anniversary", label: "Work Anniversary" },
  { slug: "resignation-rejection-letter", label: "Resignation Rejection Letter" },
  { slug: "resignation-acceptance-letter", label: "Resignation Acceptance Letter" },
];

export const duringEmploymentHref = (slug: string) => `${DURING_EMPLOYMENT_BASE}/${slug}`;

export const findDuringEmploymentSection = (slug: string) =>
  DURING_EMPLOYMENT_SECTIONS.find((s) => s.slug === slug) ?? null;
