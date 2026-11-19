// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Log activity (D, E, F) and the admin's review queue on screen; the server actions are MOCKED.
const m = vi.hoisted(() => ({ lead: vi.fn(), conv: vi.fn(), meet: vi.fn(), testi: vi.fn(), review: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
  it("with the permission the chosen month is sent; a Google review sends the chosen star rating", async () => {
    m.testi.mockResolvedValue({ ok: true });
    render(<SubmitPanel currentMonth="2026-11" canPickMonth />);
    const month = screen.getByLabelText(/Incentive month/) as HTMLInputElement;
    expect(month.max).toBe("2026-11");
    fireEvent.change(month, { target: { value: "2026-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.change(screen.getByLabelText("Stars"), { target: { value: "4" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 60"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(m.testi).toHaveBeenCalledWith(expect.objectContaining({ kind: "google_review", starRating: 4, wordCount: 70, periodMonth: "2026-09" })));
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
