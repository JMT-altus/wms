import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, employees } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/current";
import { incentiveCalcRights } from "@/lib/auth/incentive-calc";
import { incentiveFRights } from "@/lib/auth/incentive-f";
import { MasterPageHead } from "@/components/admin/master/page-head";
import { CalcTabs, CategorySwitch } from "@/components/admin/master/incentive-rules/calc-ui";
import { NoCalcAccess } from "@/components/admin/master/incentive-rules/no-calc-access";
import { FReview } from "@/components/admin/master/incentive-rules/f-review";
import { fReviewQueue } from "@/lib/queries/incentive-f-review";

export const dynamic = "force-dynamic";

/**
 * Admin & Master Setup → Incentive Calculation → Category F → Review & decisions (0137): every submitted Google review,
 * verified against the public review by someone with `incentive.f.verify` (never the submitter), its attribution, its
 * two-person invalidation (`incentive.f.invalidate`) and recovery write-off (`incentive.f.writeOff`). Seeing it needs an
 * Incentive Calculation right or one of the Category F rights; every action is checked again on the server.
 */
export default async function CategoryFReviewPage() {
  const me = await requireAdmin();
  const [calcRights, fRights] = await Promise.all([incentiveCalcRights(me), incentiveFRights(me)]);
  const head = <MasterPageHead eyebrow="Admin & Master Setup · Incentive Rules · Category F" title="Review & decisions" lede={<>Google reviews, email and letterhead testimonials are provisional until someone checks the original — the public review, the email, the letter on the customer's letterhead. Record what it actually is and says, or reject or hold it — always with a reason; a testimonial is registered once and never earns twice. Invalidations and recovery write-offs need a second person.</>} />;
  if (!calcRights.view && !fRights.verify && !fRights.invalidate && !fRights.writeOff)
    return (
      <div>
        {head}
        <NoCalcAccess />
      </div>
    );
  const queue = await fReviewQueue();
  const [people, customers] = queue.ready
    ? await Promise.all([
        db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.isActive, true)).orderBy(asc(employees.name)),
        db.select({ id: customerMasters.id, name: customerMasters.name }).from(customerMasters).orderBy(asc(customerMasters.name)).limit(1000),
      ])
    : [[], []];
  return (
    <div>
      {head}
      <CategorySwitch category="F" />
      <CalcTabs active="Review & decisions" category="F" />
      <FReview ready={queue.ready} rights={fRights} rows={queue.rows} recoveries={queue.recoveries} people={people} customers={customers} />
    </div>
  );
}
