import { redirect } from "next/navigation";
import type { Route } from "next";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getTrainingSettings } from "@/lib/queries/training";
import { TrainingSettingsForm } from "@/components/training/settings-form";
import { PageHead, Panel } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function TrainingSettingsPage() {
  const me = await requireUser();
  // The nav pill is already adminOnly, but a direct URL has to be refused too.
  if (!me.isAdmin) redirect("/training" as Route);

  const settings = await getTrainingSettings();

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1000px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="SETTINGS"
          title="Training Settings"
          sub="The numbers the Training Centre enforces. Admins and the MD can change these at any time."
        />

        <TrainingSettingsForm current={settings} />

        <Panel className="mt-5">
          <h2 className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
            What else you can change without a developer
          </h2>
          <ul className="mt-3 grid gap-2.5 text-ink-muted" style={{ fontSize: 14.5 }}>
            <Item label="Materials">
              Add, edit, archive or delete anything in the Library, and flag any item as
              induction — that alone drives the Induction page and its progress ring.
            </Item>
            <Item label="Subjects">
              Free text on each material. Type a new one and it becomes a filter option
              immediately; there is no fixed list to maintain.
            </Item>
            <Item label="Sessions">
              Schedule, reschedule, cancel or delete from the Calendar, and mark who
              attended — attendance is what unlocks a person&rsquo;s ability to rate it.
            </Item>
            <Item label="Who can do what">
              Module access is per person or per department in Admin → Access. Curation
              (materials, sessions, attendance, this page) follows the Admin flag.
            </Item>
          </ul>
        </Panel>
      </main>
      <DashboardFooter />
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="shrink-0 font-bold text-ink-strong"
        style={{ fontSize: 14.5, minWidth: 90 }}
      >
        {label}
      </span>
      <span>{children}</span>
    </li>
  );
}
