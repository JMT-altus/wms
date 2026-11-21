// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MyTestimonialStatus } from "@/components/incentive/f-status";
import type { MyFTestimonial } from "@/lib/queries/incentive-f-review";

// My Activity → the employee's own Category F verification state (0139). Read only; synthetic rows.
afterEach(cleanup);
let n = 0;
const row = (o: Partial<MyFTestimonial>): MyFTestimonial => ({ submissionId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, submittedAt: "2026-11-02T05:00:00.000Z", kind: "email", ownDate: "2026-11-01", status: "under-review", explanation: "Waiting for verification against its original.", countsIn: null, appreciation: null, ...o });

describe("My Activity — reviews and testimonials, verification", () => {
  it("lists each own submission with its type, own date, status and explanation; a verified one shows its month and whether appreciation by name was recorded", () => {
    render(
      <MyTestimonialStatus
        rows={[
          row({ kind: "email", status: "verified", ownDate: "2026-10-30", countsIn: "2026-10", appreciation: true, explanation: "Verified against its original." }),
          row({ kind: "letterhead", status: "on-hold", explanation: "Held for Admin Review." }),
          row({ kind: "google_review", status: "invalidated", explanation: "Found deleted." }),
          row({ kind: "google_review", status: "duplicate", explanation: "Already registered." }),
          row({ kind: "email", status: "rejected", explanation: "Not accepted." }),
        ]}
      />,
    );
    const region = screen.getByRole("region", { name: "My testimonials — verification" });
    expect(within(region).getAllByText("F.2 Email testimonial")).toHaveLength(2);
    expect(within(region).getAllByText("F.1 Google review")).toHaveLength(2);
    expect(within(region).getByText("F.3 Letterhead testimonial")).toBeTruthy();
    expect(region.textContent).toMatch(/dated 2026-10-30 · submitted 2026-11-02 · counts in 2026-10 · appreciation by name recorded \(F\.4\)/);
    for (const s of ["VERIFIED", "ON HOLD", "INVALIDATED", "DUPLICATE", "REJECTED"]) expect(within(region).getByText(s)).toBeTruthy();
  });
  it("offers no action at all: no verify, approve, invalidate or write-off control, no link to evidence", () => {
    render(<MyTestimonialStatus rows={[row({ status: "under-review" }), row({ status: "verified", countsIn: "2026-11", appreciation: false })]} />);
    const region = screen.getByRole("region", { name: "My testimonials — verification" });
    expect(within(region).queryAllByRole("button")).toEqual([]);
    expect(within(region).queryAllByRole("link")).toEqual([]);
    expect(within(region).queryAllByRole("textbox")).toEqual([]);
    expect(region.textContent).not.toMatch(/appreciation by name recorded/);
  });
  it("nothing submitted: says so", () => {
    render(<MyTestimonialStatus rows={[]} />);
    expect(screen.getByText("No reviews or testimonials submitted yet.")).toBeTruthy();
  });
});
