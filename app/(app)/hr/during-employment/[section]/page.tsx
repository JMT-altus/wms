import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { HrSectionPlaceholder } from "@/components/hr/section-placeholder";
import {
  DURING_EMPLOYMENT_SECTIONS,
  findDuringEmploymentSection,
} from "@/lib/hr/during-employment";

export const dynamicParams = false;

export function generateStaticParams() {
  return DURING_EMPLOYMENT_SECTIONS.map((s) => ({ section: s.slug }));
}

/** Access is the HR module's own (the /hr prefix); nothing here touches employee data. */
export default async function DuringEmploymentSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireUser();
  const { section } = await params;
  const found = findDuringEmploymentSection(section);
  if (!found) notFound();
  return (
    <HrSectionPlaceholder
      group="During Employment"
      label={found.label}
      position={DURING_EMPLOYMENT_SECTIONS.indexOf(found) + 1}
      total={DURING_EMPLOYMENT_SECTIONS.length}
      existingHref={found.existingHref}
    />
  );
}
