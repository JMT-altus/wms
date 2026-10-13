import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { HrSectionPlaceholder } from "@/components/hr/section-placeholder";
import { EXIT_SECTIONS, findExitSection } from "@/lib/hr/exit";

export const dynamicParams = false;

export function generateStaticParams() {
  return EXIT_SECTIONS.map((s) => ({ section: s.slug }));
}

/** Access is the HR module's own (the /hr prefix); nothing here touches employee data. */
export default async function ExitSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireUser();
  const { section } = await params;
  const found = findExitSection(section);
  if (!found) notFound();
  return (
    <HrSectionPlaceholder
      group="Exit"
      label={found.label}
      position={EXIT_SECTIONS.indexOf(found) + 1}
      total={EXIT_SECTIONS.length}
    />
  );
}
