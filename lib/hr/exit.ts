/**
 * HR → Exit: the sections, in the order they are listed.
 *
 * Structure only. `num` is the number printed beside the entry and is kept as
 * the company's own numbering (17–21), not the position in this list; `null`
 * prints none.
 */
export const EXIT_BASE = "/hr/exit";

export const EXIT_SECTIONS: ReadonlyArray<{
  slug: string;
  label: string;
  num: string | null;
}> = [
  { slug: "exit-interview-handover", label: "Exit Interview & Handover", num: null },
  { slug: "ffs", label: "FFS", num: "17" },
  { slug: "ffs-acknowledgement-letter", label: "FFS Acknowledgement Letter", num: "18" },
  { slug: "relieving-letter", label: "Relieving Letter", num: "19" },
  { slug: "letter-of-recommendation", label: "Letter of Recommendation", num: "20" },
  { slug: "experience-letter", label: "Experience Letter", num: "21" },
];

export const exitHref = (slug: string) => `${EXIT_BASE}/${slug}`;

export const findExitSection = (slug: string) => EXIT_SECTIONS.find((s) => s.slug === slug) ?? null;
