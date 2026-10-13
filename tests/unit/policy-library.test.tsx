// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/react";
import { PolicyLibrary, type PolicyCardData } from "@/components/hr/policy-library";

afterEach(cleanup);

const base: PolicyCardData = {
  id: "p1",
  title: "Salary Policy",
  subtitle: "Version v1.0 · Published 05-Oct-2026",
  version: "v1.0",
  fileName: "1759-salary-policy.pdf",
  downloadUrl: "https://files.example/salary.pdf",
  signed: null,
  signHref: "#policy-document",
};

describe("PolicyLibrary", () => {
  it("shows the search bar, the Firm policies heading and a genuine signed count", () => {
    render(<PolicyLibrary policies={[base]} />);
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search policies, categories, or file names")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Firm policies" })).toBeTruthy();
    expect(screen.getByText("0/1 signed")).toBeTruthy();
  });

  it("an unsigned policy offers Read & sign (to the signing panel) and Download; no signed badge", () => {
    render(<PolicyLibrary policies={[base]} />);
    const sign = screen.getByRole("link", { name: /Read & sign/ });
    expect(sign.getAttribute("href")).toBe("#policy-document");
    const dl = screen.getByRole("link", { name: "Download Salary Policy" });
    expect(dl.getAttribute("href")).toBe("https://files.example/salary.pdf");
    expect(dl.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByText(/Signed ·/)).toBeNull();
  });

  it("a signed policy shows the green signed status with its date and counts as signed", () => {
    render(<PolicyLibrary policies={[{ ...base, signed: { label: "Signed · 05-Oct-2026" } }]} />);
    expect(screen.getByText("Signed · 05-Oct-2026")).toBeTruthy();
    expect(screen.getByText("1/1 signed")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Read & sign/ })).toBeNull();
  });

  it("shows the policy mark as initials, the title and the real subtitle", () => {
    render(<PolicyLibrary policies={[base]} />);
    expect(screen.getByText("SP")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Salary Policy", level: 3 })).toBeTruthy();
    expect(screen.getByText("Version v1.0 · Published 05-Oct-2026")).toBeTruthy();
  });

  it("omits Download when there is no link, rather than showing a dead one", () => {
    render(<PolicyLibrary policies={[{ ...base, downloadUrl: null }]} />);
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });

  it("filters live by title, version and file name, and says so when nothing matches", () => {
    const second: PolicyCardData = { ...base, id: "p2", title: "Travel Policy", version: "v2", fileName: "travel.pdf", subtitle: "Version v2" };
    render(<PolicyLibrary policies={[base, second]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "travel" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Travel Policy" })).toBeTruthy();

    fireEvent.change(box, { target: { value: "SALARY-POLICY.PDF" } }); // file name, any case
    expect(within(screen.getByRole("list")).getByRole("heading", { name: "Salary Policy" })).toBeTruthy();

    fireEvent.change(box, { target: { value: "nothing like this" } });
    expect(screen.getByText(/No policies match/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();

    // The count is about the library, not the filter.
    expect(screen.getByText("0/2 signed")).toBeTruthy();

    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("the Search button does not reload the page", () => {
    render(<PolicyLibrary policies={[base]} />);
    const form = screen.getByRole("search");
    const notPrevented = fireEvent.submit(form);
    expect(notPrevented).toBe(false); // preventDefault was called
  });

  it("with no policy at all, says so honestly and shows no count and no invented card", () => {
    render(<PolicyLibrary policies={[]} />);
    expect(screen.getByText("No policies have been published yet.")).toBeTruthy();
    expect(screen.queryByText(/signed/)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("PolicyLibrary with no policies", () => {
  it("shows an honest empty state and disables the search it cannot run", () => {
    render(<PolicyLibrary policies={[]} />);
    expect(screen.getByRole("heading", { name: "Firm policies" })).toBeTruthy();
    expect(screen.getByText("No policies have been published yet.")).toBeTruthy();
    expect(screen.queryByText(/signed$/)).toBeNull();
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
