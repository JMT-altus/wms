import { CheckCircle2, FileText, FileX } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { PolicyUploadForm } from "@/components/salary/policy-upload-form";
import { PolicyLibrary, type PolicyCardData } from "@/components/hr/policy-library";
import { SignaturePad } from "@/components/salary/signature-pad";
import { requireUser } from "@/lib/auth/current";
import {
  getCurrentPolicy,
  getMyConsent,
  listConsentStatus,
} from "@/lib/queries/salary-policy";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

/** "05-Oct-2026", in IST, for the card badges. */
const fmtShort = (d: Date) =>
  d
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    .replace(/ /g, "-");

/** The warm off-white the reference page sits on, and the border its cards share. */
const GROUND = "#F7F6F3";
const LINE = "#E8E5DF";
const SURFACE = "rounded-2xl bg-white";

export default async function SalaryPolicyPage() {
  const me = await requireUser();
  const policy = await getCurrentPolicy();

  const [myConsent, consentStatus] = await Promise.all([
    policy ? getMyConsent(me.id, policy.version) : Promise.resolve(null),
    policy && me.isAdmin ? listConsentStatus(policy.version) : Promise.resolve([]),
  ]);

  // The library lists what really exists: today that is the one current salary
  // policy, with the viewer's own acknowledgement of it. No other policy record
  // exists to show, so none is made up.
  const cards: PolicyCardData[] = policy
    ? [
        {
          id: policy.id,
          title: "Salary Policy",
          subtitle: `Version ${policy.version} · Published ${fmtShort(policy.createdAt)}`,
          version: policy.version,
          fileName: policy.storagePath.split("/").pop() ?? "",
          downloadUrl: policy.url,
          signed: myConsent ? { label: `Signed · ${fmtShort(myConsent.signedAt)}` } : null,
          signHref: "#policy-document",
        },
      ]
    : [];

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <div style={{ background: GROUND }}>
        <main className="mx-auto max-w-[1180px] px-8 max-md:px-4 pt-6 pb-10 max-md:pb-8 grid gap-6">
          {/* The page's heading for assistive tech; the listing below carries the visible one. */}
          <h1 className="sr-only">Policies</h1>

          <PolicyLibrary policies={cards} />

          {/* The one publishing entry point, admins only. The server action
              re-checks admin on every call; this only decides who sees the form. */}
          {me.isAdmin ? <PolicyUploadForm compact={Boolean(policy)} /> : null}

          {!policy ? (
            // Nothing published yet: say so, in the document area's own place.
            <section
              className={`${SURFACE} px-6 py-20 max-md:py-14 text-center`}
              style={{ border: `1px solid ${LINE}`, minHeight: 360 }}
            >
              <FileX size={34} strokeWidth={1.6} aria-hidden className="mx-auto text-ink-subtle" />
              <h2 className="mt-3 text-[16px] font-bold text-ink-strong">No policy documents available</h2>
              <p className="mt-1 text-[13.5px] text-ink-muted">
                Select a policy to read it here. Nothing has been published yet.
              </p>
            </section>
          ) : (
            <div id="policy-document" className="flex flex-col gap-5 scroll-mt-6">
              {/* The policy document */}
              <section className={`${SURFACE} p-6 max-md:p-4`} style={{ border: `1px solid ${LINE}` }}>
                <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                  <div className="flex items-center gap-2">
                    <FileText size={18} strokeWidth={2.2} className="text-ink-soft" />
                    <h2 className="text-[16px] font-bold text-ink-strong">
                      Policy document · {policy.version}
                    </h2>
                  </div>
                  {policy.url ? (
                    <a
                      href={policy.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-card py-2 px-4 text-[14px] font-medium text-ink-strong hover:border-hairline-strong transition-colors"
                    >
                      Open PDF
                    </a>
                  ) : (
                    <span className="text-[13px] text-ink-subtle">PDF link unavailable</span>
                  )}
                </div>
                {policy.url ? (
                  <iframe
                    src={policy.url}
                    title={`Salary policy ${policy.version}`}
                    className="w-full rounded-md border border-hairline"
                    style={{ height: 560 }}
                  />
                ) : null}
              </section>

              {/* Consent status / sign */}
              {myConsent ? (
                <div
                  className={`${SURFACE} p-6 max-md:p-4 flex items-center gap-3`}
                  style={{ border: `1px solid ${LINE}` }}
                >
                  <CheckCircle2 size={22} strokeWidth={2.2} style={{ color: "var(--color-green)" }} />
                  <div>
                    <p className="text-[15px] font-bold text-ink-strong">
                      You have acknowledged this policy
                    </p>
                    <p className="text-[13px] text-ink-subtle mt-0.5">
                      Signed {fmtDate(myConsent.signedAt)} ({myConsent.signatureKind === "draw" ? "drawn" : "uploaded"} signature)
                    </p>
                  </div>
                </div>
              ) : (
                <SignaturePad />
              )}

              {/* Admin tools */}
              {me.isAdmin ? (
                <>
                  <section
                    className={`${SURFACE} overflow-hidden`}
                    style={{ border: `1px solid ${LINE}` }}
                  >
                    <div className="px-6 py-4 border-b border-hairline">
                      <h2 className="text-[16px] font-bold text-ink-strong">Consent overview</h2>
                      <p className="text-[13px] text-ink-subtle mt-0.5">
                        {consentStatus.filter((r) => r.consented).length} of {consentStatus.length}{" "}
                        active employees have acknowledged {policy.version}.
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[14px]">
                        <thead>
                          <tr
                            className="text-left text-[12px] uppercase tracking-[0.08em] text-ink-subtle font-bold border-b border-hairline"
                            style={{ background: "var(--color-surface-soft)" }}
                          >
                            <th className="px-6 py-3.5">Employee</th>
                            <th className="px-6 py-3.5 text-center">Consented</th>
                            <th className="px-6 py-3.5 text-right">Signed at</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consentStatus.map((r, i) => (
                            <tr
                              key={r.employeeId}
                              className="border-b border-hairline last:border-b-0"
                              style={{
                                background: i % 2 === 1 ? "rgba(15, 23, 42, 0.012)" : undefined,
                              }}
                            >
                              <td className="px-6 py-3 text-ink-strong font-medium">{r.name}</td>
                              <td className="px-6 py-3 text-center">
                                {r.consented ? (
                                  <span className="font-bold" style={{ color: "var(--color-green)" }}>
                                    ✓
                                  </span>
                                ) : (
                                  <span className="text-ink-subtle">—</span>
                                )}
                              </td>
                              <td className="px-6 py-3 text-right tabular-nums text-ink-soft">
                                {r.signedAt ? fmtDate(r.signedAt) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          )}
        </main>
      </div>
      <div className="[&>footer]:mt-0">
        <DashboardFooter />
      </div>
    </>
  );
}
