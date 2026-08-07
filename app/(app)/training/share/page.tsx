import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import {
  currentWeekStart,
  getMyShare,
  getTrainingSettings,
  listColleagueShares,
} from "@/lib/queries/training";
import { formatWeekLabel } from "@/lib/weekly-goals/week";
import { SharePanel } from "@/components/training/share-panel";
import { PageHead } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function SharePage() {
  const me = await requireUser();
  const week = currentWeekStart();
  const [mine, colleagues, settings] = await Promise.all([
    getMyShare(me.id, week),
    listColleagueShares(me.id),
    getTrainingSettings(),
  ]);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1400px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="WEEKLY SHARE"
          title="Share &amp; Learn"
          sub={`Once a week, share ${settings.shareMinMinutes} minutes of what you know — and rate what colleagues share.`}
        />
        <SharePanel
          mine={mine}
          colleagues={colleagues}
          weekLabel={formatWeekLabel(week)}
          minMinutes={settings.shareMinMinutes}
        />
      </main>
      <DashboardFooter />
    </>
  );
}
