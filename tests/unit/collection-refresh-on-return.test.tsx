// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// RefreshOnReturn: an already-open Collection Dashboard re-reads its data when the person comes back to it (another
// tab, another window, the browser's Back button) — in place, through router.refresh(), never a full reload, and
// never more than once per return.
const h = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));

import { RefreshOnReturn, resetRefreshOnReturn } from "@/components/collections/refresh-on-return";

let visibility: DocumentVisibilityState = "visible";
const T0 = new Date("2026-11-13T09:00:00Z").getTime();
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** Coming back to the tab: the browser fires both events. */
const comeBack = () => {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
};
const leave = () => {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  h.refresh.mockClear();
  resetRefreshOnReturn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RefreshOnReturn", () => {
  it("renders nothing and leaves a fresh page alone — arriving, and looking away for a moment, ask for nothing", () => {
    const { container } = render(<RefreshOnReturn loadedAt={1} />);
    expect(container.innerHTML).toBe("");
    leave();
    later(3_000);
    comeBack();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("coming back to the tab after a while refreshes once, although the browser fires two events", () => {
    render(<RefreshOnReturn loadedAt={1} />);
    leave();
    later(60_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the tab is hidden, however old the page is", () => {
    render(<RefreshOnReturn loadedAt={1} />);
    leave();
    later(600_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("the refreshed page is fresh again: no second refresh until it too has aged", () => {
    const { rerender } = render(<RefreshOnReturn loadedAt={1} />);
    later(60_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    rerender(<RefreshOnReturn loadedAt={2} />); // the server's new render arrives
    later(2_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    later(60_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("Back / Forward: a copy the browser kept is refreshed as soon as it is shown again; a new render is not", () => {
    const first = render(<RefreshOnReturn loadedAt={7} />);
    first.unmount(); // the person goes to the Tracker
    later(120_000);
    const back = render(<RefreshOnReturn loadedAt={7} />); // Back: the same render as before
    expect(h.refresh).toHaveBeenCalledTimes(1);
    back.unmount();
    h.refresh.mockClear();
    render(<RefreshOnReturn loadedAt={8} />); // an ordinary visit: the server rendered it just now
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a page restored from the browser's own page cache refreshes too (pageshow)", () => {
    render(<RefreshOnReturn loadedAt={1} />);
    later(60_000);
    window.dispatchEvent(new Event("pageshow"));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("the server's clock is never compared with this device's: a timestamp far ahead or far behind causes no refresh on arrival", () => {
    render(<RefreshOnReturn loadedAt={T0 + 86_400_000} />);
    render(<RefreshOnReturn loadedAt={T0 - 86_400_000} />);
    comeBack();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("if the refresh brings nothing new (offline), it is asked again at most once per interval", () => {
    render(<RefreshOnReturn loadedAt={1} />);
    later(60_000);
    comeBack();
    later(1_000);
    comeBack();
    later(1_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    later(10_000);
    comeBack();
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops listening once the page is left", () => {
    const { unmount } = render(<RefreshOnReturn loadedAt={1} />);
    unmount();
    later(60_000);
    comeBack();
    window.dispatchEvent(new Event("pageshow"));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("the Dashboard page mounts it with that render's own timestamp, and reads the database on every request", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const page = readFileSync("app/(collection-module)/collection/dashboard/page.tsx", "utf8");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toMatch(/<RefreshOnReturn loadedAt=\{loadedAt\} \/>/);
    expect(page).toMatch(/buildRows\(trackerParties\(source\.parties\)/);
    // No cached read anywhere between the page and the tables.
    const queries = readdirSync("lib/queries").filter((f) => f.startsWith("collection-")).map((f) => `lib/queries/${f}`);
    expect(queries.length).toBeGreaterThan(5);
    for (const f of ["lib/collections/load.ts", "lib/collections/scope-server.ts", ...queries]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/unstable_cache|"use cache"/);
    }
  });
});
