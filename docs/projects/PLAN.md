# Projects — Plan (v3)

**For:** JMT Drive Solutions · **Status:** plan only, no code
**v3 changes:** ordered by what users actually need rather than what looks impressive, and committed to a **100% free stack** — no licensed components, ever.

---

## 0 · The honest framing

The brief was "surpass Microsoft Project". Taken literally that's the wrong goal, and chasing it is how this gets abandoned half-built.

MS Project schedules 500-activity programmes for people whose full-time job is scheduling. **You have 9 employees and 13 tasks in the system.** Most of what makes it impressive — levelling algorithms, constraint solvers, earned-value analysis — is machinery for a problem you don't have.

What you *do* have is the problem MS Project is genuinely bad at: **your plans need to know your people.** Who's on leave. Which days are working days here. Who's already buried. MS Project needs a hand-maintained fiction of a calendar. Your database holds the truth.

**Goal: a planning layer that is correct about JMT's reality, that your team adopts because it costs them nothing, and that you can actually finish — for free.**

---

## 1 · What each person actually asks (this sets the priority)

Before features, the questions. Everything is ordered by how well it answers these.

**Mihir / Altus, daily:**
1. *What's late, or about to be?*
2. *Who's overloaded, who's free?*
3. *What's blocking what?*
4. *Did anything slip since yesterday?*

**An employee, daily:**
1. *What do I do today?*
2. *Am I blocked — or am I blocking someone?*
3. *When is this actually due?*

**Now the uncomfortable observation:** a Gantt chart answers **question 3 on Mihir's list**, partially answers 1 and 4, and answers **none of the employee's**. It is the most *impressive-looking* screen and nowhere near the most *useful* one.

v2 made the Gantt the centrepiece and shipped it third. That was aesthetics driving the roadmap. The screens that actually answer the questions above are:

- **"What needs attention"** — a plain list of late / at-risk / blocked items → Mihir's Q1 and Q4
- **Workload grid** → Mihir's Q2
- **My Day with project context + "you can start now"** → the employee's Q1, Q2, Q3

**Two of those three are ordinary HTML tables.** No charting library, no drag-and-drop engine, no risk. They ship earlier and are worth more than the Gantt. The Gantt comes after, as a view — not as the point.

---

## 2 · The 100% free stack

**Committed constraint: no paid components, no "free tier" that expires, no revenue-capped community licences.**

### The insight that makes this easy

Every commercial Gantt library charges for the same four things: **working-days calendar, auto-scheduling, baselines, critical path.**

We must build all four ourselves regardless — because a library's "working days calendar" knows about weekends, and knows nothing about *your* holidays table, *your* approved leave, or *your* per-person weekly-off. A generic scheduler would produce dates that are wrong for JMT.

**So the scheduling engine is ours, server-side.** Which means we need the library for one job only: **drawing bars and arrows, and handling drag.** Every paid feature is irrelevant to us.

### What we'd use

| Library | Licence | Verdict |
|---|---|---|
| **frappe-gantt** | MIT, **no paid tier at all** · core released v0.9.0 recently | **Recommended.** Nobody has a commercial incentive to keep the free version weak. Vanilla JS, so we write our own thin React wrapper (~100 lines) rather than depend on the third-party wrappers, which are all 1–4 years stale |
| SVAR React Gantt | MIT core, React 19 confirmed, actively maintained | Solid fallback. But it's **open-core**: working-days calendar, auto-scheduling, baselines and critical path are PRO-only. We don't need those from a library — just be aware the vendor's incentive is to keep moving the line |
| DHTMLX Gantt Community | MIT, but an explicitly "reduced feature set" teaser for a paid PRO | Skip — same open-core incentive, less upside |
| gantt-task-react | MIT, but **original unmaintained ~4 years**; forks 1–2 years stale | Skip |

### Already in your `package.json`, free, reusable
`@dnd-kit` (drag — already powers your Kanban) · `recharts` (charts) · `@tanstack/react-table` (grids) · `date-fns` · Radix primitives · Tailwind. **The workload grid and attention list need nothing new at all.**

### One honest caveat
"Free" here means **software licences**. Your *infrastructure* — Supabase, Vercel, Firebase, Resend — already has paid tiers at scale. This module adds rows and function time, which is negligible at 9 users, but it isn't literally zero-cost forever. No new vendor is introduced.

---

## 3 · Scope discipline — what this is NOT

| Excluded | Why | Revisit when |
|---|---|---|
| **Intake queue, scoring, stage gates** | Governance ritual for 9 people who share an office and whose approver is in the room | 30+ staff |
| **RAID log** | Dies within weeks unless someone is paid to maintain it. Risks live in project notes | Projects big enough that risks need owners |
| **Formal change control** | The audit trail already records who changed what | Billable client scope changes |
| **Budget, cost rates, EVM** | **Rates would come from salary. With one person on a work package, its cost *is* their hourly rate — anyone seeing any cost figure can back-calculate a colleague's CTC.** Aggregation doesn't protect you at this headcount | Rates come from a client rate card, not CTC |
| **Templates** | Pay off on repetition. You have 13 tasks total | After ~5 similar projects have run |

None of the work below has to be undone to add these later.

---

## 4 · The one decision everything rests on

**A project never creates a second to-do system. Work always lands as a normal WMS task.**

PMs work in `/projects`. Everyone else keeps working in `/tasks` and My Day and never has to know a planning layer exists. This is what makes adoption free. Every other choice bends to it.

---

## 5 · Fixing the hierarchy first

`project_nodes.kind` currently has **five** levels: `project → milestone → result → action → sub_action`. Collapse to three, reusing the existing values:

| Existing | Becomes | Meaning |
|---|---|---|
| `project` | **Project** | The whole endeavour |
| `milestone` | **Phase** | Discovery, Build, Handover |
| `result` | **Work package** | The unit planned, scheduled and assigned |
| `action`, `sub_action` | **retired** | These were always "a task" — WMS tasks do this |

A **checkpoint** ("Client sign-off") is a work package with **zero duration**, flagged — not a level.

`action`/`sub_action` retire the way this codebase already retires things: kept in the enum so old rows render, hidden from every picker, existing nodes migrated up. Same pattern as `DEPRECATED_TASK_STATUSES` + `isDeprecatedStatus()` in `db/enums.ts`.

**Three levels is right.** Five is more than 9 people will maintain, and unmaintained depth is how a tree becomes a graveyard.

---

## 6 · The work package ↔ task contract

The most important interface here, specified exactly.

**One work package produces one or more tasks** — "Collect client documents" for three people creates three tasks, reusing the multi-doer fan-out `createTasksCore` already does.

**Progress is derived, never typed:**
> % complete = completed tasks ÷ total tasks

No "% done" field for anyone to maintain. It moves because people do their normal job. Weight by effort where estimates exist.

**The plan owns the dates.**
- A project-linked task's due date is **set by the plan**, read-only in the task UI, with the project name as the explanation.
- Only PM/admin can override — and doing so **pins** that work package (a "must finish on" constraint) so the scheduler stops moving it. The pin is visible on the timeline.
- Unlinked tasks behave exactly as today. Nothing changes for the ~90% of work that isn't project work.

**Date changes are confirmed, never silent.** The PM sees *"this moves 6 tasks — apply?"* and approves. Dates never shift under someone's feet on their own.

---

## 7 · Progress is only as honest as your status hygiene

Said plainly, because every number depends on it.

Your app has a **"Not Seen"** status and a **"Not Read"** stat card — both built because tasks sat unopened. If people don't mark things Done promptly, % complete and health are **fiction presented as fact**, which is worse than showing nothing.

**So from Phase 1, every project carries an honesty line beside its progress:**

> *"4 of 11 items haven't been opened in 7 days — progress may be stale."*

If that line is loud, don't trust the bar above it. Better to admit it than draw a confident green bar over silence.

---

## 8 · The scheduling engine

1. **Duration** per work package — typed, or effort ÷ people.
2. **Dependencies** set order. Finish-to-Start covers ~90%; SS/FF/SF supported. **Lag/lead in days** handles real waiting ("+3 days after bank submission") without fake "wait" tasks.
3. **Forward pass** — earliest each item can start/finish.
4. **Backward pass** — latest each could run without delaying the project.
5. **Float** = the gap. How much can slip before it hurts.
6. **Zero float = critical path.**
7. **The working calendar — the whole differentiator.** The schedule skips:
   - **Weekly offs** — `employees.weeklyOff` ✅
   - **Company holidays** — `holidays` table ✅
   - **Approved leave** — `leave_requests` ✅
   - **Working hours/days** — `workingHoursStart/End`, `workingDays` ✅

   "Finishes 14 August" already knows the assignee is on leave on the 11th and the office is shut on the 12th. **Cheap, because the data already exists. Impossible for an off-the-shelf tool without an HR integration.**

8. **Overload is flagged, not auto-solved.** Automatic levelling silently rewrites your plan and destroys trust. A human decides.

**On the critical path:** worth building — it falls out of the same maths as float — but it's a supporting feature. On a 12-item project run from one office it's often obvious.

---

## 9 · Screens

### `/projects` — the list
*Project · Client · Phase · Progress · Health · Dates · Next checkpoint.* Filter by client, owner, health.

**Not a second dashboard.** Your `/` dashboard owns "how is the company doing". A rival overview page means two homepages that drift apart. Project KPIs surface on the main dashboard as **one card linking here**.

### `/projects/[id]` — four tabs
1. **Overview** — dates, progress, honesty line, team, next checkpoints, activity (existing audit feed)
2. **Plan** — view toggle: **Attention / Timeline / Board / Calendar**. Work packages expand to show their tasks, so no separate Tasks tab
3. **Team** — who's on it and their load
4. **Files** — existing documents module, filtered

### The Attention view (ships before the Gantt)
A plain list, grouped: **Late · At risk · Blocked · Slipped since yesterday.** Each row: what, who, how many days, why. This answers Mihir's daily questions directly, needs no library, and is the highest value-per-hour screen in the plan.

### The Timeline (Gantt)
Bars, checkpoint diamonds, dependency arrows, baseline ghost bars, today line, drag to reschedule, zoom.

**Critical path is not red.** Red already means overdue, `imp_urgent` priority, and several admin-customisable status tokens — a fourth meaning is noise. Critical bars get a **thicker outline, a chain icon and a label.**

**Health is never colour-only** — RAG carries a letter or shape. ~8% of men can't reliably separate red from green, and this codebase already takes accessibility seriously (`prefers-reduced-motion`, deliberate `focus-visible`).

### Mobile — explicit
**No Gantt on phones.** A vertical list: phases as sections, work packages as rows with dates and progress, your own items pinned on top. Same data, a layout that fits 390px. Your app already invests in mobile (`MobileToday`, mobile menu, `max-md` throughout).

### Performance budget
Your hardening doc records 2–4s loads and cross-region latency as the standing problem.
- Schedule **computed on write, not on read** — the timeline renders stored dates, it doesn't solve a network per page load
- Bars **virtualised**
- Past ~200 work packages, **paginate by phase**
- Target: Plan tab interactive **under 1.5s warm**

---

## 10 · The employee experience

- Work arrives as a **normal WMS task** ✅ — `/tasks`, My Day, Kanban, inbox, existing notifications
- The row gains **project context**: `PRJ-2026-014 › Discovery`
- Worked exactly as today ✅ — status, comments, attachments
- **"You can start now"** when the blocking item clears. The single most useful new signal for a doer, and the reason dependencies are worth building
- Their date changes only on a PM-confirmed reschedule, announced once

**They never** open a Gantt, maintain a plan, or type a status twice.

---

## 11 · Permissions, and one leak to close

Reuse `module_access_grants`, project `visibility`, `project_audience`.

**The leak:** tasks now default to **private**, projects still default to `internal` (everyone). So an employee could open a project timeline and see bars for tasks they **can't open** — learning how many exist and what they're called.

**Fix:**
1. Timelines show only work packages whose tasks the viewer may see; the rest aggregate as **"3 items not visible to you"** — the same pattern already used in the aging-heatmap popover
2. **Decide the project default deliberately** (§13). Tasks and projects defaulting differently is a bug waiting to happen

---

## 12 · Notification budget

The app already fires four channels per task event. At 9 people, more kinds become noise within a fortnight — and muted channels are worse than none.

**Two new kinds only:**
1. **"You can start now"** — a blocking dependency cleared
2. **"Your dates moved"** — after a PM-confirmed reschedule

Both respect the existing matrix and per-user preferences. Anything else waits until someone asks.

---

## 13 · Roadmap — ordered by user value, not by spectacle

| Phase | Ships | Needs | Answers |
|---|---|---|---|
| **1 · Foundations** | 3-level hierarchy · real start/end/duration · work-package↔task contract · derived progress · honesty line | — | *Do dates mean anything?* |
| **2 · Scheduling** | Working calendar (holidays + leave + weekly off) · dependencies · float · critical path · **"you can start now"** | 1 | **The differentiator.** Employee Q2 |
| **3 · Attention view** | Late / at-risk / blocked / slipped-since-yesterday list | 2 | **Mihir Q1 + Q4.** Plain table, no library, highest value per hour |
| **4 · Workload grid** | Real capacity from attendance + leave · over-allocation | 2 | **Mihir Q2.** HTML table + existing `dnd-kit` |
| **5 · Timeline** | Gantt (frappe-gantt + our wrapper) · drag · calendar toggle · mobile list | 2 | **Mihir Q3.** The impressive one — built once the useful ones exist |
| **6 · Baselines** | Freeze · ghost bars · variance | 5 | *How far have we drifted?* |
| **7 · Roll-up** | Project health list · one dashboard card · exports | 1–4 | Management view |

**Then stop and run two real projects before building anything else.**

**Phases 1–4 need no new dependency at all.** The first genuinely new library arrives at Phase 5, and it's MIT with no paid tier.

If you only ship 1–3, you already have true dates, dependency awareness and a live "what needs attention" list — which is most of the daily value.

---

## 14 · Decisions needed from you

Down to four — the free-stack and build-vs-buy questions are now answered.

1. **Who plans?** At 9 people, realistically you. If every plan must be built by the MD, this fails on adoption regardless of features — and the planning UI must be built for **speed** (paste a list of names, keyboard, bulk-assign), not as a form-heavy wizard. This changes the UI more than anything else here, so it's first.
2. **Project visibility default** — follow tasks (private/participants) or stay visible to everyone? Right now they disagree.
3. **Effort estimates** — will people estimate hours? If not, durations are typed directly and Phase 4 capacity becomes rough. Acceptable trade, but make it a choice.
4. **Retiring `action`/`sub_action`** — confirm nothing in your current tree depends on those levels.

Plus: **two real projects** to design against. All of this is better decided with actual work in front of us.

---

## 15 · What's already there

No invented percentages — just the list.

**Reused directly:** tasks with multi-doer fan-out · status workflow and permission matrix · comments and audit trail · four-channel notifications with per-user prefs · Kanban · My Day · documents · row-level visibility and audiences · per-module access · attendance, leave, holidays, weekly off, working hours · departments · clients · the project tree with owner/members/target date · global search infra · `dnd-kit`, `recharts`, `@tanstack/react-table`.

**To build:** duration and real start/end · dependencies · scheduling engine and working calendar · critical path and float · the work-package↔task contract · progress roll-up · attention view · workload grid · timeline + mobile list · baselines · project roll-up · projects and work packages in global search.

---

## Sources

**Gantt libraries & licensing**
- [frappe/gantt — GitHub (MIT)](https://github.com/frappe/gantt) · [frappe-gantt on npm](https://www.npmjs.com/package/frappe-gantt)
- [SVAR React Gantt — open-source edition](https://svar.dev/react/gantt/) · [@svar-ui/react-gantt on npm](https://www.npmjs.com/package/@svar-ui/react-gantt)
- [DHTMLX Gantt open-source edition](https://dhtmlx.com/docs/products/dhtmlxGantt/open-source/)
- [gantt-task-react on npm](https://www.npmjs.com/package/gantt-task-react)
- [Top 5 free and open-source JS Gantt libraries — Webix](https://blog.webix.com/best-free-javascript-gantt-chart-libraries/)

**Method**
- [Critical path method — TeamGantt](https://www.teamgantt.com/blog/critical-path) · [Wrike](https://www.wrike.com/blog/critical-path-is-easy-as-123/)
- [Task dependencies — Fast Project Software](https://www.fastprojectsoftware.com/learn/task-dependencies-project-scheduling)
- [Lag and lead time — Bonsai](https://www.hellobonsai.com/blog/lag-time-and-lead-time-in-project-management)
- [Microsoft Project baselines — Wellingtone](https://wellingtone.co.uk/microsoft-project-baselines/)
- [Balancing project workloads — Planisware](https://planisware.com/resources/resource-management-capacity-planning/step-step-blueprint-balancing-project-workloads-and)
