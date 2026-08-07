import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { listFeedbackComments, listSessionFeedback } from "@/lib/queries/training";
import {
  FeedbackPanel,
  type FeedbackComment,
} from "@/components/training/feedback-panel";
import { PageHead, StatCard } from "@/components/training/ui";

export const dynamic = "force-dynamic";

export default async function TrainingFeedbackPage() {
  const me = await requireUser();
  const sessions = await listSessionFeedback(me.id);

  // Only admins get everyone's comments; staff see their own inside the form.
  const commentMap = me.isAdmin
    ? await listFeedbackComments(sessions.map((s) => s.sessionId))
    : new Map<string, FeedbackComment[]>();
  const commentsBySession: Record<string, FeedbackComment[]> = {};
  for (const [k, v] of commentMap) commentsBySession[k] = v;

  const rated = sessions.filter((s) => s.ratingCount > 0);
  // Weighted by rating count, NOT a mean of session means — a session with one
  // 5 would otherwise count as much as one with twenty 3s, and this figure has
  // to agree with the Dashboard, which averages the raw rows.
  const totalRatings = rated.reduce((s, r) => s + r.ratingCount, 0);
  const overallAvg =
    totalRatings > 0
      ? rated.reduce((s, r) => s + (r.avgRating ?? 0) * r.ratingCount, 0) / totalRatings
      : null;
  const awaiting = sessions.filter((s) => s.iAttended && s.myRating == null).length;

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1200px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="FEEDBACK"
          title="Session Feedback"
          sub="Rate the training you attended — trainers see the scores and comments."
        />

        <div className="grid grid-cols-4 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-4 mb-6">
          <StatCard label="Sessions held" value={sessions.length} tone="teal" />
          <StatCard label="Rated" value={rated.length} tone="blue" />
          <StatCard
            label="Average score"
            value={overallAvg == null ? "—" : overallAvg.toFixed(1)}
            hint="Across every rated session"
            tone="green"
          />
          <StatCard
            label="Awaiting your rating"
            value={awaiting}
            hint={awaiting > 0 ? "Sessions you attended" : "You're all caught up"}
            tone="amber"
          />
        </div>

        <FeedbackPanel
          sessions={sessions}
          commentsBySession={commentsBySession}
          canSeeAllComments={me.isAdmin}
        />
      </main>
      <DashboardFooter />
    </>
  );
}
