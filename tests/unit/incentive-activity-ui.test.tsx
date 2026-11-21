// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Log activity (D, E, F) and the admin's review queue on screen; the server actions are MOCKED.
const m = vi.hoisted(() => ({ lead: vi.fn(), conv: vi.fn(), meet: vi.fn(), testi: vi.fn(), review: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/app/(app)/incentive/actions", () => ({ submitLeadBatch: m.lead, submitLeadConversion: m.conv, submitMeeting: m.meet, submitTestimonial: m.testi, reviewSubmission: m.review }));

import { SubmitPanel } from "@/components/incentive/submit-panel";
import { VerificationQueue } from "@/components/incentive/verification-queue";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Log activity", () => {
  it("without the permission there is no month to choose and the current month applies; no amount is printed", async () => {
    m.lead.mockResolvedValue({ ok: true });
    const { container } = render(<SubmitPanel currentMonth="2026-11" />);
    expect(screen.queryByLabelText(/Incentive month/)).toBeNull();
    expect(container.textContent).not.toMatch(/₹/);
    fireEvent.change(screen.getByPlaceholderText("e.g. 30"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit leads" }));
    await waitFor(() => expect(m.lead).toHaveBeenCalledWith({ leadCount: 25, profiled: true, periodMonth: undefined }));
  });
  it("with the permission the chosen month is sent; a Google review sends its public link, publication date, stars, screenshot and text", async () => {
    m.testi.mockResolvedValue({ ok: true });
    render(<SubmitPanel currentMonth="2026-11" canPickMonth />);
    const month = screen.getByLabelText(/Incentive month/) as HTMLInputElement;
    expect(month.max).toBe("2026-11");
    fireEvent.change(month, { target: { value: "2026-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Public Google review link"), { target: { value: "https://www.google.com/maps/reviews/x" } });
    fireEvent.change(screen.getByLabelText("Published on"), { target: { value: "2026-09-14" } });
    fireEvent.change(screen.getByLabelText("Stars"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Screenshot link"), { target: { value: "https://files.example/shot.png" } });
    fireEvent.change(screen.getByLabelText("Review text"), { target: { value: "Prompt and helpful" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(m.testi).toHaveBeenCalledWith(expect.objectContaining({ kind: "google_review", starRating: 4, reviewUrl: "https://www.google.com/maps/reviews/x", publishedOn: "2026-09-14", screenshotUrl: "https://files.example/shot.png", reviewText: "Prompt and helpful" })));
  });
  it("email and letterhead keep their own fields (words, the link to the evidence) and now also send the email's or letter's own date and text (F.2, F.3)", async () => {
    m.testi.mockResolvedValue({ ok: true });
    render(<SubmitPanel currentMonth="2026-11" />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "email" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 60"), { target: { value: "70" } });
    expect(screen.getByText("Link to the email (required)")).toBeTruthy();
    expect((screen.getByLabelText("Evidence link") as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText("Dated") as HTMLInputElement).required).toBe(true);
    fireEvent.change(screen.getByLabelText("Evidence link"), { target: { value: "https://files.example/mail.eml" } });
    fireEvent.change(screen.getByLabelText("Dated"), { target: { value: "2026-11-03" } });
    fireEvent.change(screen.getByLabelText("Testimonial text"), { target: { value: "Thanks to Asha" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Appreciates me or a teammate by name/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(m.testi).toHaveBeenCalledWith(expect.objectContaining({ kind: "email", wordCount: 70, evidenceUrl: "https://files.example/mail.eml", publishedOn: "2026-11-03", reviewText: "Thanks to Asha", namesTeamMember: true })));
    // A letterhead: its own wording.
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "letterhead" } });
    expect(screen.getByText("Link to the scanned letter (required)")).toBeTruthy();
    expect(screen.getByText("Date of the letter")).toBeTruthy();
  });
  const fillGoogle = () => {
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Public Google review link"), { target: { value: "https://www.google.com/maps/reviews/x" } });
    fireEvent.change(screen.getByLabelText("Published on"), { target: { value: "2026-09-14" } });
    fireEvent.change(screen.getByLabelText("Review text"), { target: { value: "Prompt and helpful" } });
  };
  it("a refusal (e.g. the earlier-month permission removed after the page opened) is shown; Submit works again and what was typed stays", async () => {
    let answer!: (v: { ok: false; error: string }) => void;
    m.testi.mockReturnValue(new Promise((r) => (answer = r)));
    render(<SubmitPanel currentMonth="2026-11" canPickMonth />);
    fireEvent.change(screen.getByLabelText(/Incentive month/), { target: { value: "2026-09" } });
    fillGoogle();
    const submit = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true)); // busy while the server answers
    answer({ ok: false, error: "Logging activity for an earlier month needs the “Incentive Tracker — Log activity for an earlier month” permission." });
    expect((await screen.findByRole("alert")).textContent).toMatch(/needs the “Incentive Tracker — Log activity for an earlier month” permission/);
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect((screen.getByLabelText("Public Google review link") as HTMLInputElement).value).toBe("https://www.google.com/maps/reviews/x");
    expect((screen.getByLabelText("Published on") as HTMLInputElement).value).toBe("2026-09-14");
    expect((screen.getByLabelText("Review text") as HTMLTextAreaElement).value).toBe("Prompt and helpful");
    expect(m.refresh).not.toHaveBeenCalled();
  });
  it("a call that fails without an answer is shown as a safe message (nothing internal), never an uncaught error; the form stays usable", async () => {
    m.testi.mockRejectedValue(new Error("SECRET internal detail at db.ts:42"));
    render(<SubmitPanel currentMonth="2026-11" />);
    fillGoogle();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't be submitted — your access or the page may have changed/);
    expect(alert.textContent).not.toMatch(/SECRET|db\.ts/);
    await waitFor(() => expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Public Google review link") as HTMLInputElement).value).toBe("https://www.google.com/maps/reviews/x");
  });
});

describe("Review queue", () => {
  const item = { queue: "meeting" as const, id: "11111111-1111-4111-8111-111111111111", employeeName: "Rep", period: "2026-11", summary: "High potential", needsAward: true, namesTeamMember: false };
  it("the award has no fixed range, and a refusal (e.g. reviewing your own submission) is shown", async () => {
    m.review.mockResolvedValue({ ok: false, error: "You can't review your own submission: another admin must approve or reject it." });
    render(<VerificationQueue items={[item as never]} />);
    const award = screen.getByLabelText("Award (₹)") as HTMLInputElement;
    expect(award.max).toBe("");
    fireEvent.change(award, { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(m.review).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved", awardedRupees: 1500 })));
    expect((await screen.findByRole("alert")).textContent).toMatch(/can't review your own submission/);
  });
});
