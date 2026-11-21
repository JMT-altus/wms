// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Category F → Review & decisions (0137), with the server actions MOCKED. Invented data only; no amount is decided here.
const a = vi.hoisted(() => ({ record: vi.fn(), retire: vi.fn(), invReq: vi.fn(), invDec: vi.fn(), woReq: vi.fn(), woDec: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/calculation/actions", () => ({
  recordCategoryFDecision: (...x: unknown[]) => a.record(...x),
  retireCategoryFDecision: (...x: unknown[]) => a.retire(...x),
  requestCategoryFInvalidation: (...x: unknown[]) => a.invReq(...x),
  decideCategoryFInvalidation: (...x: unknown[]) => a.invDec(...x),
  requestCategoryFWriteOff: (...x: unknown[]) => a.woReq(...x),
  decideCategoryFWriteOff: (...x: unknown[]) => a.woDec(...x),
}));

import { FReview } from "@/components/admin/master/incentive-rules/f-review";
import type { FRecovery, FReviewRow } from "@/lib/queries/incentive-f-review";

const REVIEW = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const ASHA = "55555555-5555-4555-8555-555555555555";
const URL_ = "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSURzaGVEMnZBRRAB";
const row = (over: Partial<FReviewRow> = {}): FReviewRow => ({
  reviewId: REVIEW,
  submissionId: SUB,
  submittedBy: "Ravi",
  submittedAt: "2026-11-10T09:00:00Z",
  url: URL_,
  screenshotUrl: "https://files.example/shot.png",
  claimed: { kind: "google_review", rating: 5, publishedOn: "2026-10-20", text: "Very helpful, Asha explained everything" },
  state: "new",
  verdict: null,
  attribution: null,
  invalidation: null,
  history: [],
  ...over,
});
const ALL = { verify: true, invalidate: true, writeOff: true };
const NONE = { verify: false, invalidate: false, writeOff: false };
const people = [{ id: ASHA, name: "Asha" }];
const verified = { id: "v1", kind: "verify", testimonialKind: "google_review" as const, rating: 5, publishedOn: "2026-10-20", named: ["Asha"], appreciated: ["Asha"], reason: "Checked the public review", byName: "Meera" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Category F review screen", () => {
  it("not ready until 0137 is applied", () => {
    render(<FReview ready={false} rights={ALL} rows={[]} recoveries={[]} people={[]} customers={[]} />);
    expect(screen.queryByRole("region", { name: "Submitted testimonials" })).toBeNull();
    expect(document.body.textContent).toMatch(/0137/);
  });
  it("without a right everything is read-only: no verify, attribute, invalidate or write-off controls", () => {
    const rec: FRecovery = { adjustmentId: "a1", employeeName: "Asha", fromMonth: "2026-09-01", toMonth: "2026-11-01", amountPaise: -25_000, writeOff: null };
    render(<FReview ready rights={NONE} rows={[row(), row({ submissionId: "s2", verdict: verified })]} recoveries={[rec]} people={people} customers={[]} />);
    expect(screen.getByText(/Read-only: verifying needs/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attribute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request invalidation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request write-off" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retire/ })).toBeNull();
    // The submitted review is shown with its claim and evidence — provisional, earning nothing yet.
    const list = screen.getByRole("region", { name: "Submitted testimonials" });
    expect(within(list).getAllByText(/claims 5★/)).toHaveLength(2);
    expect(within(list).getAllByRole("link", { name: "screenshot" })[0]!.getAttribute("rel")).toContain("noopener");
  });
  it("a verifier records the ACTUAL rating, publication date, text, review ID, who is named and who is appreciated by name (F.4) — with a reason", async () => {
    a.record.mockResolvedValue({ ok: true });
    render(<FReview ready rights={ALL} rows={[row()]} recoveries={[]} people={people} customers={[]} />);
    const verify = screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true); // a reason is required
    fireEvent.change(screen.getByLabelText("Actual rating"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Original date"), { target: { value: "2026-10-18" } });
    fireEvent.change(screen.getByLabelText("Google review ID"), { target: { value: "ChdDSUhNMG9nS0VJQ0FnSURzaGVEMnZBRRAB" } });
    const named = screen.getByLabelText("Salespeople named in it") as HTMLSelectElement;
    named.options[0]!.selected = true;
    fireEvent.change(named);
    const appreciated = screen.getByLabelText("Appreciated by name (F.4)") as HTMLSelectElement;
    appreciated.options[0]!.selected = true;
    fireEvent.change(appreciated);
    fireEvent.change(screen.getByLabelText(`Reason for ${URL_}`), { target: { value: "Checked the public review" } });
    fireEvent.click(verify);
    await waitFor(() =>
      expect(a.record).toHaveBeenCalledWith({ kind: "verify", reviewId: REVIEW, reason: "Checked the public review", testimonialKind: "google_review", rating: 4, publishedOn: "2026-10-18", reviewText: "Very helpful, Asha explained everything", googleReviewId: "ChdDSUhNMG9nS0VJQ0FnSURzaGVEMnZBRRAB", namedEmployeeIds: [ASHA], appreciatedEmployeeIds: [ASHA], customerMasterId: null, evidence: null, confirmedFromCustomer: false, confirmedType: false, confirmedGenuine: false }),
    );
    expect(a.refresh).toHaveBeenCalled();
  });
  it("a refusal from the server (e.g. verifying your own submission) is shown as an error", async () => {
    a.record.mockResolvedValue({ ok: false, error: "You can't verify a review you submitted." });
    render(<FReview ready rights={ALL} rows={[row()]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText(`Reason for ${URL_}`), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: "You can't verify a review you submitted.", type: "error" }));
    expect(a.record).toHaveBeenCalledWith({ kind: "reject", reviewId: REVIEW, reason: "x" });
  });
  it("a duplicate offers nothing to verify; a short link must be linked to its full review first", async () => {
    a.record.mockResolvedValue({ ok: true });
    render(<FReview ready rights={ALL} rows={[row({ state: "duplicate" }), row({ submissionId: "s3", reviewId: null, state: "unresolved", url: "https://maps.app.goo.gl/abc" })]} recoveries={[]} people={people} customers={[]} />);
    expect(screen.getByText("Duplicate — never earns twice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Full link for https://maps.app.goo.gl/abc"), { target: { value: URL_ } });
    fireEvent.change(screen.getByLabelText("Reason for linking https://maps.app.goo.gl/abc"), { target: { value: "Opened the short link" } });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(a.record).toHaveBeenCalledWith({ kind: "link", submissionId: "s3", reason: "Opened the short link", url: URL_ }));
  });
  it("a verified review: attribution with a basis, invalidation needs evidence and a reason, a pending invalidation is decided by a second person", async () => {
    a.record.mockResolvedValue({ ok: true });
    a.invReq.mockResolvedValue({ ok: true });
    a.invDec.mockResolvedValue({ ok: true });
    const { unmount } = render(<FReview ready rights={ALL} rows={[row({ verdict: verified })]} recoveries={[]} people={people} customers={[]} />);
    expect(screen.getByText(/Verified: F\.1 Google review, 5★, dated .*names Asha; appreciates by name \(F\.4\): Asha/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Credited salesperson"), { target: { value: ASHA } });
    expect((screen.getByLabelText("Basis") as HTMLSelectElement).value).toBe("named");
    fireEvent.change(screen.getByLabelText(`Reason for attributing ${URL_}`), { target: { value: "Named in the review" } });
    fireEvent.click(screen.getByRole("button", { name: "Attribute" }));
    await waitFor(() => expect(a.record).toHaveBeenCalledWith({ kind: "attribute", reviewId: REVIEW, reason: "Named in the review", creditedEmployeeId: ASHA, basis: "named" }));
    const req = screen.getByRole("button", { name: "Request invalidation" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(`Reason for invalidating ${URL_}`), { target: { value: "Review removed by Google" } });
    expect(req.disabled).toBe(true); // evidence is required too
    fireEvent.change(screen.getByLabelText(`Evidence for invalidating ${URL_}`), { target: { value: "https://files.example/removed.png" } });
    fireEvent.click(req);
    await waitFor(() => expect(a.invReq).toHaveBeenCalledWith({ reviewId: REVIEW, reason: "Review removed by Google", evidenceUrl: "https://files.example/removed.png" }));
    unmount();

    render(<FReview ready rights={ALL} rows={[row({ verdict: verified, invalidation: { requestId: "q1", byName: "Meera", reason: "Removed", evidence: "x.png", decided: null } })]} recoveries={[]} people={people} customers={[]} />);
    expect(screen.getByText(/Invalidation requested/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(`Reason for deciding the invalidation of ${URL_}`), { target: { value: "Confirmed removed" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve invalidation" }));
    await waitFor(() => expect(a.invDec).toHaveBeenCalledWith({ requestId: "q1", decision: "approve", reason: "Confirmed removed" }));
  });
  it("an approved invalidation is final: no verify or attribute controls remain", () => {
    render(<FReview ready rights={ALL} rows={[row({ verdict: verified, invalidation: { requestId: "q1", byName: "Meera", reason: "Removed", evidence: null, decided: "approved" } })]} recoveries={[]} people={people} customers={[]} />);
    expect(screen.getByText(/Invalidated \(approved by a second person\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attribute" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request invalidation" })).toBeNull();
  });
  it("a recovery write-off is requested with an amount and a reason, then approved or refused by a second person", async () => {
    a.woReq.mockResolvedValue({ ok: true });
    a.woDec.mockResolvedValue({ ok: true });
    const rec: FRecovery = { adjustmentId: "a1", employeeName: "Asha", fromMonth: "2026-09-01", toMonth: "2026-11-01", amountPaise: -25_000, writeOff: null };
    const { unmount } = render(<FReview ready rights={ALL} rows={[]} recoveries={[rec]} people={people} customers={[]} />);
    const amount = screen.getByLabelText("Write-off amount for Asha") as HTMLInputElement;
    expect(amount.value).toBe("250");
    fireEvent.change(amount, { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Reason for writing off Asha's recovery"), { target: { value: "Left the company" } });
    fireEvent.click(screen.getByRole("button", { name: "Request write-off" }));
    await waitFor(() => expect(a.woReq).toHaveBeenCalledWith({ adjustmentId: "a1", amountPaise: 10_000, reason: "Left the company", evidenceUrl: null }));
    unmount();

    render(<FReview ready rights={ALL} rows={[]} recoveries={[{ ...rec, writeOff: { requestId: "w1", amountPaise: 10_000, byName: "Meera", reason: "Left", decided: null } }]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText("Reason for deciding the write-off for Asha"), { target: { value: "Agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(a.woDec).toHaveBeenCalledWith({ requestId: "w1", decision: "refuse", reason: "Agreed" }));
  });
});

describe("Category F review screen: refusals (a right missing or removed after the page opened)", () => {
  const DENY = (right: string) => ({ ok: false as const, error: `You don't have the “Incentive Calculation — ${right}” permission (it may have been removed). Nothing was changed.` });
  /** A promise the test answers itself, to see the busy state while the server "works". */
  const deferred = <T,>() => {
    let answer!: (v: T) => void;
    const promise = new Promise<T>((r) => (answer = r));
    return { promise, answer };
  };

  it("missing before the page opened: no action controls at all (the server still checks every action)", () => {
    render(<FReview ready rights={NONE} rows={[row()]} recoveries={[]} people={people} customers={[]} />);
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.getByText(/Read-only: verifying needs/)).toBeTruthy();
  });
  it("verify refused after the page opened: the message is shown, the buttons work again, everything typed stays, no refresh", async () => {
    const d = deferred<ReturnType<typeof DENY>>();
    a.record.mockReturnValue(d.promise);
    render(<FReview ready rights={ALL} rows={[row()]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText("Actual rating"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Google review ID"), { target: { value: "ChdABC" } });
    fireEvent.change(screen.getByLabelText(`Reason for ${URL_}`), { target: { value: "Checked the public review" } });
    const verify = screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement;
    fireEvent.click(verify);
    await waitFor(() => expect(verify.disabled).toBe(true)); // busy while the server answers
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    d.answer(DENY("Verify Category F reviews and testimonials (F.1–F.4)"));
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: expect.stringMatching(/Verify Category F reviews and testimonials \(F\.1–F\.4\)” permission \(it may have been removed\)/), type: "error" }));
    await waitFor(() => expect(verify.disabled).toBe(false));
    expect((screen.getByLabelText("Actual rating") as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText("Google review ID") as HTMLInputElement).value).toBe("ChdABC");
    expect((screen.getByLabelText(`Reason for ${URL_}`) as HTMLInputElement).value).toBe("Checked the public review");
    expect(a.refresh).not.toHaveBeenCalled();
    // Retrying once the right is back works, and only then is the page refreshed.
    a.record.mockResolvedValue({ ok: true });
    fireEvent.click(verify);
    await waitFor(() => expect(a.refresh).toHaveBeenCalledTimes(1));
    expect(a.record).toHaveBeenCalledTimes(2);
  });
  it("a call that fails without an answer (thrown): a safe message, nothing internal; the form is usable again", async () => {
    a.record.mockRejectedValue(new Error("Forbidden — stack at actions.ts:229"));
    render(<FReview ready rights={ALL} rows={[row()]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText(`Reason for ${URL_}`), { target: { value: "x" } });
    const reject = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
    fireEvent.click(reject);
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: expect.stringMatching(/your access or the page may have changed/), type: "error" }));
    expect(JSON.stringify(a.toast.mock.calls)).not.toMatch(/stack|actions\.ts/);
    await waitFor(() => expect(reject.disabled).toBe(false));
    expect((screen.getByLabelText(`Reason for ${URL_}`) as HTMLInputElement).value).toBe("x");
  });
  it("invalidation request and decision refused: message shown, buttons usable again, reason and evidence kept", async () => {
    a.invReq.mockResolvedValue(DENY("Invalidate a Category F review or testimonial"));
    const verified = { id: "v1", kind: "verify", testimonialKind: "google_review" as const, rating: 5, publishedOn: "2026-10-20", named: [], appreciated: [], reason: "ok", byName: "Meera" };
    const { unmount } = render(<FReview ready rights={ALL} rows={[row({ verdict: verified, attribution: { id: "t1", employeeName: "Asha", basis: "claim", reason: "x", byName: "Meera" } })]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText(`Evidence for invalidating ${URL_}`), { target: { value: "https://files.example/removed.png" } });
    fireEvent.change(screen.getByLabelText(`Reason for invalidating ${URL_}`), { target: { value: "Removed by Google" } });
    const req = screen.getByRole("button", { name: "Request invalidation" }) as HTMLButtonElement;
    fireEvent.click(req);
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: expect.stringMatching(/Invalidate a Category F review or testimonial” permission/), type: "error" }));
    await waitFor(() => expect(req.disabled).toBe(false));
    expect((screen.getByLabelText(`Evidence for invalidating ${URL_}`) as HTMLInputElement).value).toBe("https://files.example/removed.png");
    expect((screen.getByLabelText(`Reason for invalidating ${URL_}`) as HTMLInputElement).value).toBe("Removed by Google");
    unmount();

    a.invDec.mockResolvedValue(DENY("Invalidate a Category F review or testimonial"));
    render(<FReview ready rights={ALL} rows={[row({ verdict: verified, invalidation: { requestId: "q1", byName: "Meera", reason: "Removed", evidence: null, decided: null } })]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText(`Reason for deciding the invalidation of ${URL_}`), { target: { value: "Confirmed" } });
    const approve = screen.getByRole("button", { name: "Approve invalidation" }) as HTMLButtonElement;
    fireEvent.click(approve);
    await waitFor(() => expect(a.invDec).toHaveBeenCalled());
    await waitFor(() => expect(approve.disabled).toBe(false));
    expect((screen.getByLabelText(`Reason for deciding the invalidation of ${URL_}`) as HTMLInputElement).value).toBe("Confirmed");
    expect(a.refresh).not.toHaveBeenCalled();
  });
  it("write-off request and decision refused: message shown, buttons usable again, amount and reason kept", async () => {
    const d = deferred<ReturnType<typeof DENY>>();
    a.woReq.mockReturnValue(d.promise);
    const rec: FRecovery = { adjustmentId: "a1", employeeName: "Asha", fromMonth: "2026-09-01", toMonth: "2026-11-01", amountPaise: -25_000, writeOff: null };
    const { unmount } = render(<FReview ready rights={ALL} rows={[]} recoveries={[rec]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText("Write-off amount for Asha"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Reason for writing off Asha's recovery"), { target: { value: "Left the company" } });
    const req = screen.getByRole("button", { name: "Request write-off" }) as HTMLButtonElement;
    fireEvent.click(req);
    await waitFor(() => expect(req.disabled).toBe(true));
    d.answer(DENY("Write off a Category F recovery"));
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: expect.stringMatching(/Write off a Category F recovery” permission/), type: "error" }));
    await waitFor(() => expect(req.disabled).toBe(false));
    expect((screen.getByLabelText("Write-off amount for Asha") as HTMLInputElement).value).toBe("120");
    expect((screen.getByLabelText("Reason for writing off Asha's recovery") as HTMLInputElement).value).toBe("Left the company");
    unmount();

    a.woDec.mockResolvedValue(DENY("Write off a Category F recovery"));
    render(<FReview ready rights={ALL} rows={[]} recoveries={[{ ...rec, writeOff: { requestId: "w1", amountPaise: 10_000, byName: "Meera", reason: "Left", decided: null } }]} people={people} customers={[]} />);
    fireEvent.change(screen.getByLabelText("Reason for deciding the write-off for Asha"), { target: { value: "Agreed" } });
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    fireEvent.click(approve);
    await waitFor(() => expect(a.woDec).toHaveBeenCalled());
    await waitFor(() => expect(approve.disabled).toBe(false));
    expect((screen.getByLabelText("Reason for deciding the write-off for Asha") as HTMLInputElement).value).toBe("Agreed");
  });
  it("retiring a decision refused: the box stays open with the reason as typed; the button works again", async () => {
    a.retire.mockResolvedValue(DENY("Verify Category F reviews and testimonials (F.1–F.4)"));
    const verified = { id: "v1", kind: "verify", testimonialKind: "google_review" as const, rating: 5, publishedOn: "2026-10-20", named: [], appreciated: [], reason: "ok", byName: "Meera" };
    render(<FReview ready rights={ALL} rows={[row({ verdict: verified })]} recoveries={[]} people={people} customers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: `Retire Retire the decision on ${URL_}` }));
    const reason = screen.getByLabelText(`Reason for retiring Retire the decision on ${URL_}`) as HTMLInputElement;
    fireEvent.change(reason, { target: { value: "Rating misread" } });
    const confirm = screen.getAllByRole("button", { name: "Retire" }).at(-1) as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(a.toast).toHaveBeenCalledWith({ message: expect.stringMatching(/Verify Category F reviews and testimonials \(F\.1–F\.4\)” permission/), type: "error" }));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect((screen.getByLabelText(`Reason for retiring Retire the decision on ${URL_}`) as HTMLInputElement).value).toBe("Rating misread");
  });
});

describe("Category F review screen: email (F.2) and letterhead (F.3) testimonials", () => {
  const MAIL = "https://files.example/mail-77.eml";
  const doc = (kind: "email" | "letterhead") => row({ url: MAIL, screenshotUrl: null, claimed: { kind, rating: null, publishedOn: "2026-09-12", text: "Thanks to Asha" } });
  const CUST = { id: "66666666-6666-4666-8666-666666666666", name: "Cust A" };
  it("an email shows its type and date (no stars); it can't be verified until its customer, its sender and subject and all three findings are recorded (the Message-ID is optional)", async () => {
    a.record.mockResolvedValue({ ok: true });
    render(<FReview ready rights={ALL} rows={[doc("email")]} recoveries={[]} people={people} customers={[CUST]} />);
    expect(screen.getByText(/F\.2 Testimonial on email · dated/)).toBeTruthy();
    expect(screen.queryByLabelText("Actual rating")).toBeNull();
    expect((screen.getByLabelText("Testimonial type") as HTMLSelectElement).value).toBe("email");
    fireEvent.change(screen.getByLabelText(`Reason for ${MAIL}`), { target: { value: "Checked the original email" } });
    const verify = screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true); // no customer, identity or findings yet
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: CUST.id } });
    // No free-text identity any more: the sender, subject and (optional) Message-ID as the email shows them.
    expect(screen.queryByLabelText("Evidence identity")).toBeNull();
    const findings = within(screen.getByRole("group", { name: "Verifier's findings" })).getAllByRole("checkbox");
    expect(findings.map((c) => c.parentElement!.textContent)).toEqual(["The email is genuinely from the customer (sender checked)", "It is an email testimonial", "The testimonial is genuine"]);
    for (const f of findings) fireEvent.click(f);
    expect(verify.disabled).toBe(true); // no sender or subject yet
    fireEvent.change(screen.getByLabelText("Sender's email address"), { target: { value: "Cust A <accounts@cust-a.example>" } });
    expect(verify.disabled).toBe(true); // no subject yet
    fireEvent.change(screen.getByLabelText("Email subject"), { target: { value: "Thank you" } });
    expect(verify.disabled).toBe(false); // the Message-ID is optional
    fireEvent.change(screen.getByLabelText("Message-ID"), { target: { value: "<CA+77@cust-a.example>" } });
    fireEvent.click(findings[1]!);
    expect(verify.disabled).toBe(true); // one finding missing again
    fireEvent.click(findings[1]!);
    fireEvent.click(verify);
    await waitFor(() =>
      expect(a.record).toHaveBeenCalledWith({ kind: "verify", reviewId: REVIEW, reason: "Checked the original email", testimonialKind: "email", rating: null, publishedOn: "2026-09-12", reviewText: "Thanks to Asha", googleReviewId: null, namedEmployeeIds: [], appreciatedEmployeeIds: [], customerMasterId: CUST.id, evidence: { messageId: "<CA+77@cust-a.example>", sender: "Cust A <accounts@cust-a.example>", subject: "Thank you" }, confirmedFromCustomer: true, confirmedType: true, confirmedGenuine: true }),
    );
  });
  it("a letterhead's findings are the letterhead's; vague praise is recorded as nobody appreciated (no F.4); its reference number is optional", async () => {
    a.record.mockResolvedValue({ ok: true });
    render(<FReview ready rights={ALL} rows={[doc("letterhead")]} recoveries={[]} people={people} customers={[CUST]} />);
    const findings = within(screen.getByRole("group", { name: "Verifier's findings" })).getAllByRole("checkbox");
    expect(findings.map((c) => c.parentElement!.textContent)).toEqual(["The letterhead is the customer's", "It is a testimonial on that letterhead", "The testimonial is genuine"]);
    expect(screen.getByText(/Vague praise without a name: none/)).toBeTruthy();
    expect([...(screen.getByLabelText("Appreciated by name (F.4)") as HTMLSelectElement).selectedOptions]).toEqual([]);
    expect(screen.queryByLabelText("Sender's email address")).toBeNull();
    fireEvent.change(screen.getByLabelText(`Reason for ${MAIL}`), { target: { value: "Checked the original letter" } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: CUST.id } });
    for (const f of findings) fireEvent.click(f);
    fireEvent.change(screen.getByLabelText("Letter reference number"), { target: { value: "CA/2026/77" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(a.record).toHaveBeenCalledWith(expect.objectContaining({ testimonialKind: "letterhead", customerMasterId: CUST.id, evidence: { reference: "CA/2026/77" } })));
  });
  it("a verified letter shows its type and who it appreciates by name", () => {
    const v = { id: "v2", kind: "verify", testimonialKind: "letterhead" as const, rating: null, publishedOn: "2026-09-15", named: [], appreciated: ["Asha"], reason: "ok", byName: "Meera" };
    render(<FReview ready rights={ALL} rows={[{ ...doc("letterhead"), verdict: v }]} recoveries={[]} people={people} customers={[CUST]} />);
    expect(screen.getByText(/Verified: F\.3 Testimonial on the customer's letterhead, dated .*names no salesperson; appreciates by name \(F\.4\): Asha/)).toBeTruthy();
  });
});
