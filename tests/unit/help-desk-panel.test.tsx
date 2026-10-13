// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelpDeskPanel } from "@/components/hr/help-desk-panel";

afterEach(cleanup);

describe("HelpDeskPanel (UI only)", () => {
  it("shows the title, Raise a Ticket, and an honest empty state with no tickets", () => {
    render(<HelpDeskPanel />);
    expect(screen.getByRole("heading", { name: "HR Help Desk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Raise a Ticket/ })).toBeTruthy();
    expect(screen.getByText("No tickets yet")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("opens the form with subject, category and description; Cancel closes it", () => {
    render(<HelpDeskPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Raise a Ticket/ }));
    const form = screen.getByRole("form", { name: "Raise a ticket" });
    for (const l of ["Subject", "Category", "Description"]) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
    // Free text: no category list is baked in.
    expect(form.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("cannot submit and says so, rather than reporting success", () => {
    render(<HelpDeskPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Raise a Ticket/ }));
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not connected yet/)).toBeTruthy();
    expect(screen.queryByText(/submitted|success|raised/i)).toBeNull();
  });
});
