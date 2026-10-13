import { notFound } from "next/navigation";
import { DashboardHeader } from "@/components/layout/header";
import { requireUser } from "@/lib/auth/current";
import {
  POST_APPOINTMENT_SECTIONS,
  findPostAppointmentSection,
} from "@/lib/hr/post-appointment";

export const dynamicParams = false;

export function generateStaticParams() {
  return POST_APPOINTMENT_SECTIONS.map((s) => ({ section: s.slug }));
}

/**
 * One placeholder per Post-Appointment section. Access is the HR module's own
 * (the /hr prefix); nothing here reads or writes employee data.
 */
export default async function PostAppointmentSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireUser();
  const { section } = await params;
  const found = findPostAppointmentSection(section);
  if (!found) notFound();
  const n = POST_APPOINTMENT_SECTIONS.findIndex((s) => s.slug === found.slug) + 1;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: "#F7F6F3" }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-6 pb-10 max-md:pb-8 grid gap-6">
          <header>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">
              HR · Post-Appointment · {n} of {POST_APPOINTMENT_SECTIONS.length}
            </div>
            <h1 className="mt-1 text-[26px] font-bold text-ink-strong">{found.label}</h1>
          </header>
          <section
            className="rounded-2xl bg-white p-8 max-md:p-5 text-center"
            style={{ border: "1px solid #E8E5DF" }}
          >
            <p className="text-[15px] font-bold text-ink-strong">Not implemented yet</p>
            <p className="mt-1 text-[13.5px] text-ink-muted">
              This section is part of the Post-Appointment structure. Its content has not been built.
            </p>
          </section>
        </main>
      </div>
    </>
  );
}
