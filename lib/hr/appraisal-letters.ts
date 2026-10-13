/**
 * HR → Appraisal Letters: the sections, in the order they are listed.
 *
 * Structure only. `num` is the number printed beside the entry and is kept as
 * the company's own numbering (14–16), not the position in this list;
 * `null` prints none.
 */
export const APPRAISAL_LETTERS_BASE = "/hr/appraisal-letters";

export const APPRAISAL_LETTER_SECTIONS: ReadonlyArray<{
  slug: string;
  label: string;
  num: string | null;
}> = [
  { slug: "appraisal", label: "Appraisal", num: null },
  { slug: "promotion-letter", label: "Promotion Letter", num: "14" },
  { slug: "salary-revision-letter", label: "Salary Revision Letter", num: "15" },
  { slug: "appraisal-promotion-letter", label: "Appraisal + Promotion Letter", num: "16" },
];

export const appraisalLetterHref = (slug: string) => `${APPRAISAL_LETTERS_BASE}/${slug}`;

export const findAppraisalLetterSection = (slug: string) =>
  APPRAISAL_LETTER_SECTIONS.find((s) => s.slug === slug) ?? null;
