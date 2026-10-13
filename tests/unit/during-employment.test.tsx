// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { MODULES } from "@/lib/nav-modules";
import { RailGroup } from "@/components/layout/rail-group";
import { HrSectionPlaceholder } from "@/components/hr/section-placeholder";
import { DURING_EMPLOYMENT_SECTIONS } from "@/lib/hr/during-employment";

// The real header is a server component; the placeholder only needs it to exist.
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));

afterEach(cleanup);

const ORDER = [
  "Declaration Status",
  "Induction",
  "Employee of the Month",
  "Birthday",
  "Work Anniversary",
  "Resignation Rejection Letter",
  "Resignation Acceptance Letter",
];

const group = () =>
  MODULES.find((m) => m.id === "hr")!.items.find((i) => i.label === "During Employment")!;

describe("HR → During Employment", () => {
  it("lists the seven sections in the requested order, after Post-Appointment", () => {
    expect(group().children!.map((c) => c.label)).toEqual(ORDER);
    expect(DURING_EMPLOYMENT_SECTIONS.map((s) => s.label)).toEqual(ORDER);
    const labels = MODULES.find((m) => m.id === "hr")!.items.map((i) => i.label);
    expect(labels.indexOf("During Employment")).toBe(labels.indexOf("Post-Appointment") + 1);
    expect(group().children!.every((c) => c.href.startsWith("/hr/during-employment/"))).toBe(true);
  });

  it("renders as a numbered, foldable group", () => {
    render(<RailGroup item={group()} Icon={Users} pathname="/hr/policies" accent="#000" collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /During Employment/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("7.")).toBeTruthy();
  });

  it("points Induction at the page that already exists instead of duplicating it", () => {
    const induction = DURING_EMPLOYMENT_SECTIONS.find((s) => s.slug === "induction")!;
    render(<HrSectionPlaceholder group="During Employment" label="Induction" position={2} total={7} existingHref={induction.existingHref} />);
    expect(screen.getByText("Not implemented yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /existing induction page/i }).getAttribute("href")).toBe("/training/induction");
  });
});
