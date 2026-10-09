// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { ClientAddressRow, ClientContactRow } from "@/lib/queries/client-kyc";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/forms/client-kyc/address-book",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The server actions reach the database; nothing here saves.
vi.mock("@/app/(forms-module)/forms/client-kyc/actions", () => ({
  deleteClientAddresses: vi.fn(),
  updateClientAddress: vi.fn(),
  deleteClientContacts: vi.fn(),
  updateClientContact: vi.fn(),
}));

import { ClientAddressBook } from "@/components/forms/client-address-book";
import { ClientContactMaster } from "@/components/forms/client-contact-master";

const address: ClientAddressRow = {
  id: "a1", company: "Alpha Ltd", code: "00001", typeLabel: "Billing Address",
  addressType: "billing" as ClientAddressRow["addressType"],
  street: "1 Main Rd", line1: "1 Main Rd", line2: null, line3: null, line4: null,
  city: "Pune", state: "Maharashtra", country: "India", pinCode: "411001", email: null,
};
const contact: ClientContactRow = {
  id: "c1", company: "Alpha Ltd", code: "00001", typeLabel: "Purchase Contact",
  contactType: "purchase" as ClientContactRow["contactType"],
  firstName: "Asha", lastName: "Rao", designation: "Buyer", department: "Purchase",
  designationId: null, departmentId: null, contactNo: "9876543210",
  email: "asha@alpha.test", isPrimary: true, notes: null,
};

afterEach(cleanup);

function checks(openGrid: () => void, hideLabel: string) {
  openGrid();
  fireEvent.click(screen.getByRole("button", { name: /^grid$/i }));
  const headings = () => screen.queryAllByRole("columnheader").map((h) => h.textContent);

  // The two searches are gone; the column menu stays.
  expect(screen.queryByPlaceholderText("Search company")).toBeNull();
  expect(screen.queryByPlaceholderText(/search all columns/i)).toBeNull();
  expect(screen.queryByLabelText("Column to search")).toBeNull();
  expect(screen.getByRole("button", { name: "Choose columns" })).toBeTruthy();
  expect(headings()).toContain(hideLabel);

  // Hide one, then bring it back.
  fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
  fireEvent.click(screen.getByLabelText(hideLabel));
  expect(headings()).not.toContain(hideLabel);
  expect(headings()).toContain("Company");
  fireEvent.click(screen.getByLabelText(hideLabel));
  expect(headings()).toContain(hideLabel);
}

describe("Forms grid views — only the All columns menu", () => {
  it("Client Address Book", () => {
    checks(
      () => render(<ClientAddressBook rows={[address]} states={["Maharashtra"]} countries={["India"]} />),
      "City",
    );
    // The row's data is still on screen after hiding and re-showing a column.
    expect(screen.queryAllByText("Pune").length + screen.queryAllByDisplayValue("Pune").length).toBeGreaterThan(0);
  });

  it("Client Contact Master", () => {
    checks(
      () => render(<ClientContactMaster rows={[contact]} designations={[]} departments={[]} />),
      "Designation",
    );
    expect(screen.getByDisplayValue("Asha")).toBeTruthy();
  });
});
