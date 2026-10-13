import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { HrSectionPlaceholder } from "@/components/hr/section-placeholder";
import { APPRAISAL_LETTER_SECTIONS, findAppraisalLetterSection } from "@/lib/hr/appraisal-letters";

export const dynamicParams = false;

export function generateStaticParams() {
  return APPRAISAL_LETTER_SECTIONS.map((s) => ({ section: s.slug }));
}

/** Access is the HR module's own (the /hr prefix); nothing here touches employee data. */
export default async function AppraisalLettersSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireUser();
  const { section } = await params;
  const found = findAppraisalLetterSection(section);
  if (!found) notFound();
  return (
    <HrSectionPlaceholder
      group="Appraisal Letters"
      label={found.label}
      position={APPRAISAL_LETTER_SECTIONS.indexOf(found) + 1}
      total={APPRAISAL_LETTER_SECTIONS.length}
    />
  );
}
