// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

// The Custom recurrence dialog and presets in the Scheduling block: what a person can pick, and the rule that is saved.
// The rule strings here are exactly what lib/recurrence/rrule.ts then schedules from.
import { RecurrenceControl, buildRule, detectPreset, humanSummary, parseRule } from "@/components/tasks/recurrence-control";
import { parseRRule } from "@/lib/recurrence/rrule";
import { CreateTaskSchema, EditTaskFieldsSchema } from "@/lib/validators/task";

Element.prototype.scrollIntoView = vi.fn();
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const MON_2_NOV = new Date(2026, 10, 2, 12); // the first Monday of November
const JAN_31 = new Date(2026, 0, 31, 12);
type Value = { recurrence: string | null; recurrenceRule: string | null };

function Harness({ anchor = MON_2_NOV, initial, spy }: { anchor?: Date; initial?: Value; spy: (v: Value) => void }) {
  const [v, setV] = useState<Value>(initial ?? { recurrence: null, recurrenceRule: null });
  return (
    <RecurrenceControl
      anchor={anchor}
      recurrence={v.recurrence as never}
      recurrenceRule={v.recurrenceRule}
      onChange={(n) => {
        setV(n);
        spy(n);
      }}
    />
  );
}
const pick = async (trigger: HTMLElement, option: RegExp | string) => {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};
const openCustom = async () => {
  await pick(screen.getByRole("button", { name: /Does not repeat/ }), /Custom/);
  return screen.findByRole("dialog");
};
const done = (d: HTMLElement) => fireEvent.click(within(d).getByRole("button", { name: "Done" }));
const unit = () => screen.getByRole("button", { name: "Repeat unit" });

afterEach(cleanup);

describe("the unit dropdown inside the dialog", () => {
  it("offers Day, Week, Month and Year in a list layered ABOVE the dialog (the reason Week appeared to do nothing)", async () => {
    render(<Harness spy={vi.fn()} />);
    const dialog = await openCustom();
    expect(dialog.className).toContain("z-[120]");
    fireEvent.click(unit());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["day", "week", "month", "year"]);
    expect(options[0]!.closest("[data-radix-popper-content-wrapper] > *")?.className).toContain("z-[130]");
  });

  it("Month, every 3 months: saves the start's day, with the frequency", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    await pick(unit(), "month");
    fireEvent.change(within(d).getByLabelText("Repeat every"), { target: { value: "3" } });
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "monthly", recurrenceRule: "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=2" }));
    expect(screen.getByText(/Every 3 months on day 2/)).toBeTruthy();
  });

  it("the interval can be cleared and retyped: 2 stays 2, not 12", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    const box = within(d).getByLabelText("Repeat every") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "" } });
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "2" } });
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "weekly", recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO" }));
  });

  it("from the 31st it says what short months do", async () => {
    render(<Harness anchor={JAN_31} spy={vi.fn()} />);
    await openCustom();
    await pick(unit(), "month");
    expect(screen.getByText("Months without day 31 use their last day.")).toBeTruthy();
  });
});

describe("weekdays", () => {
  it("several can be selected; clicked out of order, they save in calendar order", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    fireEvent.click(within(d).getByRole("button", { name: "Friday" }));
    fireEvent.click(within(d).getByRole("button", { name: "Wednesday" }));
    expect(within(d).getByRole("button", { name: "Monday" }).getAttribute("aria-pressed")).toBe("true");
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "weekly", recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" }));
  });

  it("switching to Week from a daily rule keeps the weekday already shown when another is added", async () => {
    const spy = vi.fn();
    render(<Harness initial={{ recurrence: "daily", recurrenceRule: "FREQ=DAILY;INTERVAL=2" }} spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const d = await screen.findByRole("dialog");
    await pick(unit(), "weeks");
    fireEvent.click(within(d).getByRole("button", { name: "Tuesday" }));
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "weekly", recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU" }));
  });

  it("the last selected weekday can't be removed", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    fireEvent.click(within(d).getByRole("button", { name: "Monday" }));
    expect(within(d).getByRole("button", { name: "Monday" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ends", () => {
  it("On a date: saved with a monthly rule; an end before the start is refused", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    await pick(unit(), "month");
    fireEvent.click(within(d).getByRole("radio", { name: /^On/ }));
    const date = d.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    expect(within(d).getByRole("alert").textContent).toMatch(/can't be before/);
    expect((within(d).getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(date, { target: { value: "2027-03-31" } });
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "monthly", recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=2;UNTIL=2027-03-31" }));
  });

  it("After N occurrences", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const d = await openCustom();
    await pick(unit(), "month");
    fireEvent.click(within(d).getByRole("radio", { name: /After/ }));
    fireEvent.change(within(d).getByLabelText("Occurrences"), { target: { value: "6" } });
    done(d);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ recurrence: "monthly", recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=2;COUNT=6" }));
  });
});

describe("presets", () => {
  it.each([
    ["Daily", "daily", "FREQ=DAILY"],
    [/^Weekly on Monday/, "weekly", "FREQ=WEEKLY;BYDAY=MO"],
    [/^Monthly on day 2/, "monthly", "FREQ=MONTHLY;BYMONTHDAY=2"],
    [/^Monthly on the first Monday/, "monthly", "FREQ=MONTHLY;BYDAY=1MO"],
    [/^Annually on November 2/, "yearly", "FREQ=YEARLY"],
    [/^Every weekday/, "weekly", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  ] as const)("%s", async (label, recurrence, recurrenceRule) => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await pick(screen.getByRole("button", { name: /Does not repeat/ }), label as RegExp | string);
    expect(spy).toHaveBeenCalledWith({ recurrence, recurrenceRule });
    expect(parseRRule(recurrenceRule)).not.toBeNull();
    // Reopened, the same preset is shown.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("saving and reopening", () => {
  it.each([
    "FREQ=MONTHLY;BYMONTHDAY=2",
    "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=2;COUNT=6",
    "FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=2;UNTIL=2028-01-01",
    "FREQ=MONTHLY;BYDAY=1MO",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10",
    "FREQ=DAILY;INTERVAL=3",
  ])("%s comes back identical", (rule) => {
    expect(buildRule(parseRule(rule)!, MON_2_NOV)).toBe(rule);
  });

  it("the Custom dialog reopens on the saved month settings", async () => {
    render(<Harness initial={{ recurrence: "monthly", recurrenceRule: "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=2;COUNT=6" }} spy={vi.fn()} />);
    expect(screen.getByText(/Every 2 months on day 2, 6 times/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const d = await screen.findByRole("dialog");
    expect((within(d).getByLabelText("Repeat every") as HTMLInputElement).value).toBe("2");
    expect(unit().textContent).toMatch(/months/);
    expect((within(d).getByLabelText("Occurrences") as HTMLInputElement).value).toBe("6");
    expect((within(d).getByRole("radio", { name: /After/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("a saved day is described as saved, even if the start date has since moved", () => {
    expect(humanSummary("FREQ=MONTHLY;BYMONTHDAY=15", MON_2_NOV)).toBe("Every month on day 15");
    expect(detectPreset("FREQ=MONTHLY;BYMONTHDAY=15", MON_2_NOV)).toBe("custom");
    expect(detectPreset("FREQ=MONTHLY;BYMONTHDAY=2", MON_2_NOV)).toBe("monthlyDay");
  });
});

describe("server validation", () => {
  it("accepts a rule the engine can run and refuses one it can't, on edit as on create", () => {
    expect(EditTaskFieldsSchema.safeParse({ recurrence: "monthly", recurrenceRule: "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31" }).success).toBe(true);
    expect(EditTaskFieldsSchema.safeParse({ recurrence: null, recurrenceRule: null }).success).toBe(true);
    expect(EditTaskFieldsSchema.safeParse({ recurrenceRule: "every month" }).success).toBe(false);
    const create = CreateTaskSchema.safeParse({ recurrenceRule: "FREQ=FORTNIGHTLY" });
    expect(create.success).toBe(false);
    expect(create.error?.issues.some((i) => i.path[0] === "recurrenceRule")).toBe(true);
  });
});
