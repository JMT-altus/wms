// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup, screen, within, fireEvent } from "@testing-library/react";
import { AttendanceOverview } from "@/components/attendance/overview/kpi-cards";
import { PeriodSelect } from "@/components/attendance/overview/period-select";
import { WelcomeHero } from "@/components/attendance/overview/welcome-hero";
import { MonthCalendar } from "@/components/attendance/overview/month-calendar";
import { UpcomingHolidays } from "@/components/attendance/overview/upcoming-holidays";
import { computeOverview } from "@/lib/attendance/overview";
import type { DayRow } from "@/lib/queries/attendance-status";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

function day(logDate: string, over: Partial<DayRow> = {}): DayRow {
  return {
    logDate, weekday: new Date(`${logDate}T00:00:00Z`).getUTCDay(), inAt: null, outAt: null,
    isWeeklyOff: false, code: "P", dayValue: 1, late: false, leftEarly: false,
    lateWaived: false, workedMinutes: 540, ...over,
  };
}

const today = "2026-10-09";
const days = [
  day("2026-10-01"),
  day("2026-10-02", { code: "H", workedMinutes: 0 }),
  day("2026-10-05", { code: "H/D", dayValue: 0.5, workedMinutes: 270 }),
  day("2026-10-06", { code: "A", dayValue: 0, workedMinutes: 0 }),
];
const kpis = computeOverview(days, { start: "2026-10-01", end: today }, 540);

describe("AttendanceOverview", () => {
  const selector = <div data-testid="selector">month + year</div>;

  it("renders the selector slot, no old period filters, and all six KPI cards", () => {
    render(<AttendanceOverview kpis={kpis} selector={selector} />);
    expect(screen.getByTestId("selector")).toBeTruthy();
    for (const old of ["This Week", "This Month", "Last Month", "Last 3 Months"]) {
      expect(screen.queryByText(old)).toBeNull();
    }
    for (const label of ["Salary Lost", "Hours Worked", "Hours Balance", "Effective Days Worked", "Half Days", "Grace + Condoned"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 1 absent day + a half day lost.
    expect(screen.getByText("1.5 days")).toBeTruthy();
  });

  it("shows actual vs expected for hours and days", () => {
    render(<AttendanceOverview kpis={kpis} selector={selector} />);
    expect(screen.getByText(/Actual 13h 30m \/ Expected/)).toBeTruthy();
    expect(screen.getByText(/Actual 1.5 \/ Expected/)).toBeTruthy();
  });

  it("shows the dates the figures cover next to the heading", () => {
    render(<AttendanceOverview kpis={kpis} selector={selector} rangeLabel="1 Oct – 9 Oct 2026" />);
    expect(screen.getByText(/1 Oct – 9 Oct 2026/)).toBeTruthy();
  });

  it("marks a month with no working days as not available rather than inventing a balance", () => {
    const empty = computeOverview([], { start: "2026-11-01", end: "2026-10-09" }, 540);
    render(<AttendanceOverview kpis={empty} selector={selector} notStarted />);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByText(/hasn.t started yet/i)).toBeTruthy();
  });

  it("falls back to a message, not made-up numbers, when the data could not load", () => {
    render(<AttendanceOverview kpis={null} selector={selector} error />);
    expect(screen.getByText(/couldn.t load your attendance figures/i)).toBeTruthy();
    expect(screen.queryByText("Salary Lost")).toBeNull();
  });
});

describe("WelcomeHero", () => {
  it("shows the greeting as the page heading, with the subtitle and date", () => {
    render(
      <WelcomeHero
        greeting="Good to see you, Asha"
        subtitle="Your attendance, working hours and monthly summary at a glance."
        dateLabel="Fri, 09 Oct 2026"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good to see you, Asha");
    expect(screen.getByText(/monthly summary at a glance/)).toBeTruthy();
    expect(screen.getByText("Fri, 09 Oct 2026")).toBeTruthy();
  });
});

describe("PeriodSelect", () => {
  const years = [2026, 2025, 2024];

  it("offers all twelve months and the given years, with the selection applied", () => {
    render(<PeriodSelect year={2025} month={3} years={years} currentYear={2026} currentMonth={10} />);
    const month = screen.getByLabelText("Month") as HTMLSelectElement;
    const year = screen.getByLabelText("Year") as HTMLSelectElement;
    expect([...month.options].map((o) => o.text)).toEqual([
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ]);
    expect([...year.options].map((o) => o.text)).toEqual(["2026", "2025", "2024"]);
    expect(month.value).toBe("3");
    expect(year.value).toBe("2025");
  });

  it("changes month and year together as one period, in the URL", () => {
    pushMock.mockClear();
    render(<PeriodSelect year={2025} month={3} years={years} currentYear={2026} currentMonth={10} />);
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2024" } });
    // March, in the NEW year — not the current year's March.
    expect(pushMock).toHaveBeenLastCalledWith("/attendance?y=2024&m=3", { scroll: false });
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "11" } });
    expect(pushMock).toHaveBeenLastCalledWith("/attendance?y=2024&m=11", { scroll: false });
  });

  it("picking the current month and year goes back to the plain page", () => {
    pushMock.mockClear();
    render(<PeriodSelect year={2025} month={3} years={years} currentYear={2026} currentMonth={10} />);
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "10" } });
    expect(pushMock).toHaveBeenLastCalledWith("/attendance", { scroll: false });
  });
});

describe("MonthCalendar", () => {
  it("renders the month, weekday headers, a weekly hours column, nav links and a legend", () => {
    render(
      <MonthCalendar days={days} year={2026} month={10} today={today}
        prevHref="/attendance?y=2026&m=9" nextHref="/attendance?y=2026&m=11" todayHref="/attendance" />,
    );
    expect(screen.getByText("October 2026")).toBeTruthy();
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) expect(screen.getByText(d)).toBeTruthy();
    expect(screen.getByLabelText("Previous month").getAttribute("href")).toBe("/attendance?y=2026&m=9");
    expect(screen.getByLabelText("Next month").getAttribute("href")).toBe("/attendance?y=2026&m=11");
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const g of ["Present", "Half Day", "Absent", "Holiday", "Weekly Off", "Worked on off day", "Leave"]) {
      expect(within(legend).getByText(g)).toBeTruthy();
    }
    // Week of Thu 1 – Sun 4: one 9h Present + a holiday.
    expect(screen.getAllByText("9h").length).toBeGreaterThan(0);
  });

  it("draws the neighbouring months' dates faded, with no status", () => {
    const { container } = render(
      <MonthCalendar days={days} year={2026} month={10} today={today} prevHref="/a" nextHref="/b" todayHref="/c" />,
    );
    // Oct 2026 opens on a Thursday: Mon 28 – Wed 30 Sep fill the first row.
    const faded = container.querySelectorAll('[aria-hidden="true"]');
    const texts = [...faded].map((n) => n.textContent).filter((t) => /^[0-9]+$/.test(t ?? ""));
    expect(texts).toEqual(expect.arrayContaining(["28", "29", "30"]));
  });

  it("shades the whole Sunday column with one band, header to last row, in the 7th grid column", () => {
    const { container } = render(
      <MonthCalendar days={days} year={2026} month={10} today={today} prevHref="/a" nextHref="/b" todayHref="/c" />,
    );
    const bands = container.querySelectorAll('[data-testid="sunday-band"]');
    expect(bands).toHaveLength(1);
    const band = bands[0] as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    const cell = band.firstElementChild as HTMLElement;
    expect(cell.style.gridColumn).toBe("7");
    expect(cell.style.background).toMatch(/#F1F3F5|rgb\(241, 243, 245\)/i);
    // One band is the same grid template the rows use, so it lines up with them.
    expect(band.style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr)) 60px");
    // It sits behind the header and the weeks.
    expect(band.className).toMatch(/absolute/);
    expect(band.className).toMatch(/z-0/);
    expect(band.className).toMatch(/pointer-events-none/);
  });

  it("keeps Absent red and Weekly Off labelled: the band does not recolour any status", () => {
    const sun = [
      day("2026-10-03", { code: "A", dayValue: 0, workedMinutes: 0 }),
      day("2026-10-04", { code: "W/O", workedMinutes: 0, weekday: 0, isWeeklyOff: true }),
      day("2026-10-11", { code: "HP", dayValue: 2, weekday: 0, isWeeklyOff: true }),
    ];
    const { container } = render(
      <MonthCalendar days={sun} year={2026} month={10} today="2026-10-31" prevHref="/a" nextHref="/b" todayHref="/c" />,
    );
    const cellFor = (d: string) => container.querySelector('[title^="' + d + '"]') as HTMLElement;
    // Weekly off keeps its own code and label…
    expect(cellFor("2026-10-04").textContent).toContain("WO");
    expect(cellFor("2026-10-04").title).toMatch(/Weekly Off/);
    // …a worked off-day keeps its status and tint on top of the band…
    expect(cellFor("2026-10-11").textContent).toContain("HP");
    expect(cellFor("2026-10-11").title).toMatch(/Worked on off day/);
    // …and an absence is still the absent tint, never the grey.
    expect(cellFor("2026-10-03").title).toMatch(/Absent/);
    expect(cellFor("2026-10-03").style.background).not.toMatch(/F1F3F5|241, 243, 245/i);
  });

  it("disables an arrow when there is no month in that direction", () => {
    render(
      <MonthCalendar days={days} year={2026} month={10} today={today} prevHref={null} nextHref={null} todayHref="/c" />,
    );
    expect(screen.getByLabelText(/Previous month/).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByLabelText(/Next month/).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByLabelText(/Previous month/).getAttribute("href")).toBeNull();
  });

  it("shows an error message instead of an empty grid when the month could not load", () => {
    render(
      <MonthCalendar days={[]} year={2026} month={10} today={today} prevHref="/a" nextHref="/b" todayHref="/c" error />,
    );
    expect(screen.getByText(/couldn.t load this month/i)).toBeTruthy();
  });
});

describe("the /attendance page", () => {
  it("no longer renders the punch card, its subtitle or any punch control", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../app/(app)/attendance/page.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/PunchCard|punch-card/);
    expect(src).not.toMatch(/Check in when you start/);
    // Not the personal punch log, not the team table, nor any punch control.
    expect(src).not.toMatch(/My last 14 days|MyLog|TeamSection|Team —|TeamPunchButton|TeamDatePicker/);
    expect(src).not.toMatch(/listMyAttendance|listTeamAttendanceForDate/);
    // The greeting is the signed-in employee's own name, never a literal one.
    expect(src).toMatch(/greetingFor\(me\.name\)/);
    // One period, month + year; the four old filters and their date maths are gone.
    expect(src).not.toMatch(/parsePeriod|periodRange|PeriodKey|sp\.p\b/);
    expect(src).toMatch(/parseYearMonth\(sp\.y, sp\.m, today\)/);
    expect(src).not.toMatch(/Altus|Nishant/);
    expect(src).toMatch(/Your attendance, working hours and monthly summary at a glance\./);
  });

  it("keeps the sections in the agreed order: welcome, overview, calendar, holidays", () => {
    const src = readFileSync(path.resolve(__dirname, "../../app/(app)/attendance/page.tsx"), "utf8");
    const at = (s: string) => src.indexOf(s);
    expect(at("greetingFor(me.name)")).toBeGreaterThan(0);
    expect(at("<AttendanceOverview")).toBeGreaterThan(at("greetingFor(me.name)"));
    expect(at("<MonthCalendar")).toBeGreaterThan(at("<AttendanceOverview"));
    expect(at("<UpcomingHolidays")).toBeGreaterThan(at("<MonthCalendar"));
  });

  it("ends where its content ends: no reserved gap above the shared footer", () => {
    const src = readFileSync(path.resolve(__dirname, "../../app/(app)/attendance/page.tsx"), "utf8");
    // The footer's own top margin is neutralised for this page only…
    expect(src).toMatch(/\[&>footer\]:mt-0/);
    // …and nothing here reserves viewport height or a tall bottom pad.
    expect(src).not.toMatch(/min-h-screen|min-h-\[|h-screen|pb-(16|20|24|32)\b/);
    // The shared footer itself is untouched.
    const footer = readFileSync(path.resolve(__dirname, "../../components/layout/footer.tsx"), "utf8");
    expect(footer).toMatch(/className="mt-32"/);
  });

  it("leaves the punch, team and mobile pieces in place for their other callers", () => {
    for (const f of [
      "components/attendance/punch-card.tsx",
      "components/attendance/team-punch-button.tsx",
      "components/attendance/team-date-picker.tsx",
      "lib/queries/attendance.ts",
    ]) {
      expect(existsSync(path.resolve(__dirname, "../..", f))).toBe(true);
    }
    expect(existsSync(path.resolve(__dirname, "../../components/attendance/punch-card.tsx"))).toBe(true);
    expect(existsSync(path.resolve(__dirname, "../../app/api/mobile/attendance/punch/route.ts"))).toBe(true);
  });
});

describe("UpcomingHolidays", () => {
  const rows = [
    { id: "1", holidayDate: "2026-10-20", label: "Diwali", isActive: true, isOptional: false, createdAt: new Date() },
    { id: "2", holidayDate: "2026-10-10", label: "Founders Day", isActive: true, isOptional: false, createdAt: new Date() },
  ];

  it("lists the holidays it is given, with weekday and time remaining, collapsible", () => {
    const { container } = render(<UpcomingHolidays holidays={rows} today={today} />);
    expect(screen.getByText("Diwali")).toBeTruthy();
    expect(screen.getByText(/Tuesday/)).toBeTruthy(); // 20 Oct 2026
    expect(screen.getByText("Tomorrow")).toBeTruthy(); // 10 Oct
    expect(screen.getByText("In 11 days")).toBeTruthy();
    const details = container.querySelector("details")!;
    expect(details.hasAttribute("open")).toBe(true);
    expect(container.querySelector("summary")).toBeTruthy();
  });

  it("shows the full date, e.g. 20 October 2026, with the weekday", () => {
    render(<UpcomingHolidays holidays={rows} today={today} />);
    expect(screen.getByText(/20 October 2026/)).toBeTruthy();
    expect(screen.getByText(/10 October 2026/)).toBeTruthy();
  });

  it("badges an optional holiday and shows the policy note; mandatory ones get neither", () => {
    const optional = {
      id: "3", holidayDate: "2026-10-20", label: "Dussehra", isActive: true, isOptional: true, createdAt: new Date(),
    };
    render(<UpcomingHolidays holidays={[optional]} today={today} />);
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getByText(/take any/i)).toBeTruthy();
    expect(screen.getByText(/Leave Card/)).toBeTruthy();
    cleanup();

    render(<UpcomingHolidays holidays={rows} today={today} />);
    expect(screen.queryByText("Optional")).toBeNull();
    expect(screen.queryByText(/Leave Card/)).toBeNull();
  });

  it("keeps separate entries for holidays on consecutive days", () => {
    const close = ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"].map((d, i) => ({
      id: String(i), holidayDate: d, label: i < 2 ? "Diwali" : i === 2 ? "New Year" : "Bhai Dooj",
      isActive: true, isOptional: false, createdAt: new Date(),
    }));
    const { container } = render(<UpcomingHolidays holidays={close} today={today} />);
    expect(container.querySelectorAll("li")).toHaveLength(4);
    expect(screen.getAllByText("Diwali")).toHaveLength(2);
  });

  it("says so when there are none, and when it couldn't load", () => {
    render(<UpcomingHolidays holidays={[]} today={today} />);
    expect(screen.getByText("No upcoming holidays scheduled.")).toBeTruthy();
    cleanup();
    render(<UpcomingHolidays holidays={[]} today={today} error />);
    expect(screen.getByText(/couldn.t load holidays/i)).toBeTruthy();
  });
});
