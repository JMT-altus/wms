/**
 * HR → Post-Appointment: the sections, in the order they are listed.
 *
 * Structure only. The nav, the placeholder pages and the tests all read this one
 * list, so a section is added or renamed in a single place.
 */
export const POST_APPOINTMENT_BASE = "/hr/post-appointment";

export const POST_APPOINTMENT_SECTIONS = [
  { slug: "candidate-records", label: "Candidate Records" },
  { slug: "compliance-acknowledgment-letter", label: "Employee Compliance and Acknowledgment Letter" },
  { slug: "policy-signature-letter", label: "Policy Signature Letter" },
  { slug: "undertaking-minor-letter", label: "Undertaking Minor Letter" },
  { slug: "appointment-letter", label: "Appointment Letter" },
  { slug: "declaration-letter", label: "Declaration Letter" },
  { slug: "end-of-probation-period", label: "End of Probation Period" },
  { slug: "ctc-breakup-letter", label: "CTC Breakup Letter" },
  { slug: "onboarding-form", label: "Onboarding Form" },
] as const;

export type PostAppointmentSlug = (typeof POST_APPOINTMENT_SECTIONS)[number]["slug"];

export const postAppointmentHref = (slug: string) => `${POST_APPOINTMENT_BASE}/${slug}`;

export const findPostAppointmentSection = (slug: string) =>
  POST_APPOINTMENT_SECTIONS.find((s) => s.slug === slug) ?? null;
