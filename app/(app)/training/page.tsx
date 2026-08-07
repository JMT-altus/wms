import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { listMaterialSubjects, listMaterials } from "@/lib/queries/training";
import { LibraryTable } from "@/components/training/library-table";
import { PageHead } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function TrainingLibraryPage() {
  const me = await requireUser();
  const [rows, subjects] = await Promise.all([
    listMaterials({ viewerId: me.id }),
    listMaterialSubjects(),
  ]);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1500px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="TRAINING CENTRE"
          title="Material Library"
          sub={
            me.isAdmin
              ? "Watch the material and mark it done. Add and manage material here."
              : "Watch the material and mark it done."
          }
        />
        <LibraryTable rows={rows} subjects={subjects} canCurate={me.isAdmin} />
      </main>
      <DashboardFooter />
    </>
  );
}
