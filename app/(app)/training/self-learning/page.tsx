import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { getSelfLearningMonth, istYmd } from "@/lib/queries/training";
import { SelfLearningPanel } from "@/components/training/self-learning-panel";
import { PageHead } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function SelfLearningPage() {
  const me = await requireUser();
  const month = await getSelfLearningMonth(me.id);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1400px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="SKILL UPGRADE"
          title="Self-Learning"
          sub="Log what you learn from books, videos and YouTube — with evidence."
        />
        {/* Today comes from the server in IST so the date field never defaults
            to yesterday for someone whose device clock is off. */}
        <SelfLearningPanel month={month} todayYmd={istYmd(new Date())} />
      </main>
      <DashboardFooter />
    </>
  );
}
