// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Loading and error states shared by every Collection page (app/(collection-module)/collection/).
import CollectionLoading from "@/app/(collection-module)/collection/loading";
import CollectionErrorBoundary from "@/app/(collection-module)/collection/error";

afterEach(cleanup);

describe("Collection route states", () => {
  it("loading: paints the page's shape and marks itself busy", () => {
    const { container } = render(<CollectionLoading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("error: explains both likely causes plainly, offers a way back and a retry, and shows no details", () => {
    const reset = vi.fn();
    render(<CollectionErrorBoundary error={Object.assign(new Error("connect ECONNREFUSED secret-host:5432"), { digest: "abc123" })} reset={reset} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/haven.t been given access .* or something went wrong/);
    expect(alert.textContent).toMatch(/Field Permissions/);
    expect(alert.textContent).not.toMatch(/ECONNREFUSED|secret-host/); // never the raw message
    expect(alert.textContent).toContain("ref: abc123"); // the opaque digest, for support
    expect(screen.getByRole("link", { name: "Back to the Tracker" }).getAttribute("href")).toBe("/collection/tracker");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("error: no reference line when there is no digest", () => {
    render(<CollectionErrorBoundary error={new Error("Forbidden")} reset={() => {}} />);
    expect(screen.getByRole("alert").textContent).not.toMatch(/ref:/);
  });
});
