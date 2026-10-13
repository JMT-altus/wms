// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListChecks } from "lucide-react";
import { MODULES } from "@/lib/nav-modules";
import { RailGroup } from "@/components/layout/rail-group";
import { POST_APPOINTMENT_SECTIONS } from "@/lib/hr/post-appointment";

afterEach(cleanup);

const ORDER = [
  "Candidate Records",
  "Employee Compliance and Acknowledgment Letter",
  "Policy Signature Letter",
  "Undertaking Minor Letter",
  "Appointment Letter",
  "Declaration Letter",
  "End of Probation Period",
  "CTC Breakup Letter",
  "Onboarding Form",
];

const group = () => MODULES.find((m) => m.id === "hr")!.items.find((i) => i.children)!;

describe("HR → Post-Appointment", () => {
  it("lists the nine sections in the requested order, under HR", () => {
    expect(group().label).toBe("Post-Appointment");
    expect(group().children!.map((c) => c.label)).toEqual(ORDER);
    expect(POST_APPOINTMENT_SECTIONS.map((s) => s.label)).toEqual(ORDER);
    const hrefs = group().children!.map((c) => c.href);
    expect(new Set(hrefs).size).toBe(9);
    expect(hrefs.every((h) => h.startsWith("/hr/post-appointment/"))).toBe(true);
  });

  it("folds and unfolds, numbered, opening when a child is the current page", () => {
    const closed = render(
      <RailGroup item={group()} Icon={ListChecks} pathname="/hr/policies" accent="#000" collapsed={false} />,
    );
    const toggle = screen.getByRole("button", { name: /Post-Appointment/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Candidate Records")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("9.")).toBeTruthy();
    closed.unmount();

    render(
      <RailGroup
        item={group()}
        Icon={ListChecks}
        pathname="/hr/post-appointment/appointment-letter"
        accent="#000"
        collapsed={false}
      />,
    );
    expect(screen.getByRole("button", { name: /Post-Appointment/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /Appointment Letter/ }).getAttribute("aria-current")).toBe("page");
  });
});
