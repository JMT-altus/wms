# Projects — How it works, for each person (v2)

**Companion to [PLAN.md](./PLAN.md) v2.** Same system, told as a story: what you click, in what order, what you see.

- **Mihir Veera / Altus Corp** — MD + Admin. Sees everything, and realistically does the planning.
- **An employee** — one of the other seven. Sees their own work.

**Legend:** ✅ works today · 🔶 to be built

---

# PART 1 — Mihir Veera / Altus Corp

## 1 · Get there ✅
Sign in → Hub → **WMS** → nav: Dashboard · My Day · Tasks · Kanban · **Projects** · Weekly Goals.

## 2 · The project list 🔶
Not a second dashboard — your `/` dashboard keeps that job. This answers one question: *which projects exist and which are in trouble.*

A table: **Project · Client · Phase · Progress · Health · Dates · Next checkpoint**, filterable by client, owner and health. On the main dashboard, a single project card links here.

## 3 · Create a project 🔶
Click **New Project**: name, client (existing list ✅), owner, planned start and end, visibility. No intake form, no scoring, no approval gate — at 9 people you *are* the approval.

## 4 · Build the plan 🔶
Three levels, no more:

**Project → Phase → Work package**

- **Phases** are stages: Discovery, Build, Handover.
- **Work packages** are the planned units. Each gets: name, owner(s), duration in days (or effort in hours), and optionally a "checkpoint" flag for zero-day milestones like *Client sign-off*.

Because you'll be the one typing this, entry is built to be **fast** — paste a list of names and they become work packages, then fill dates inline. Not a multi-step wizard.

**Draw dependencies** — drag between bars. *"Site survey" must finish before "Prepare quotation" starts.* Add **lag** for real waiting: *+3 days after bank submission* — no fake "wait for bank" task.

## 5 · The schedule calculates itself 🔶
You never type an end date. The engine walks the chain and **skips**:
- weekly offs ✅ · company holidays ✅ · approved leave ✅ · each person's working hours ✅

So *"finishes 14 August"* already knows Ramesh is on leave on the 11th and the office is shut on the 12th. **This is the part MS Project can't do without a manually-maintained calendar, and your data already holds the truth.**

Work packages with zero slack are the **critical path** — marked with a thicker outline, a chain icon and a label. *Not* red: red already means overdue, urgent priority, and several status tokens.

## 6 · Assign 🔶→✅
Assigning a work package **creates normal WMS tasks** — one per person. They land in that person's `/tasks`, My Day, Kanban and inbox with the usual notification ✅.

## 7 · Watch it run 🔶

**The Plan tab** — one tab, four views via a toggle:
- **Attention** — the one you'll live in. A plain list: **Late · At risk · Blocked · Slipped since yesterday**, each row saying what, who, how many days and why. Answers your daily questions directly, and needs no chart at all
- **Timeline (Gantt)** — bars, dependency arrows, drag to reschedule, baseline ghost bars, today line
- **Board** — Kanban, for whoever prefers it
- **Calendar** — month grid with holidays and leave shaded in

Each work package expands to show its tasks, so there's no separate Tasks tab.

**Progress is derived, never typed:** % complete = completed tasks ÷ total tasks. It moves because people do their normal job.

**The honesty line** — beside every progress bar:
> *"4 of 11 items haven't been opened in 7 days — progress may be stale."*

If that line is loud, don't trust the bar above it. Better than a confident green bar drawn over silence.

**Rescheduling is confirmed, never silent.** Drag a bar and you get: *"This moves 6 tasks — apply?"* You approve; one notification goes out. Dates never move under people's feet on their own.

**Overload is flagged, not auto-fixed.** If someone has 60 hours in a 45-hour week you'll see it. No algorithm silently rewrites your plan.

## 8 · Baseline 🔶
Click **Set Baseline** to freeze the plan. Ghost bars then sit under the real ones, so drift is visible at a glance and "we're 9 days late" is a fact, not an argument.

## 9 · Capacity 🔶
The **workload grid** — people down, weeks across — built from real availability (working days minus weekly off, holidays and approved leave). Answers *"can we take this on?"* honestly.

## 10 · What you won't find here
No budget, no cost, no SPI/CPI. Deliberately — cost rates would come from salary, and with one person on a work package its cost *is* their hourly rate. At 9 people anyone seeing a cost figure could back-calculate a colleague's CTC. Revisit when rates come from a client rate card instead.

No intake queue, no stage gates, no RAID log, no change-control board. Governance ritual for a company where the approver sits in the room.

---

# PART 2 — An employee

**Their day barely changes. That's the design, not a limitation.**

## 1 · Work arrives ✅
A notification (email / Slack / WhatsApp / push, per their preferences) → the task is in their Inbox and Tasks list.

## 2 · Their list ✅ + 🔶
`/tasks` and My Day work exactly as now ✅. One addition 🔶 — project context on the row:

> **Collect client documents** · *PRJ-2026-014 › Discovery* · due 14 Aug

## 3 · Doing it ✅
Same controls as today: read, move status (**Not Seen → Not Started → Initiated → Follow Up → Done**), comment, attach files. Marking it Done moves the project's progress automatically.

## 4 · The two genuinely new things 🔶
1. **"You can start now"** — the moment the task blocking them finishes, they're told. No more chasing. This is the single most useful new signal for a doer, and the reason dependencies are worth building at all.
2. **"Your dates moved"** — only after the PM confirms a reschedule. Once, deliberately.

That's the entire notification addition. Two kinds, not eight.

## 5 · Their due date is read-only 🔶
For project-linked tasks the date comes from the plan, shown with the project name as the explanation. Only the PM or an admin can override it — and doing so **pins** that work package so the scheduler stops moving it. Unlinked tasks behave exactly as today ✅.

## 6 · What they see of the project 🔶
A read-only view: phases, dates, their own items, the team.

They see **only** work packages whose tasks they're allowed to open. Anything else shows as *"3 items not visible to you"* — the same pattern already used in the aging-heatmap popover.

## 7 · On a phone 🔶
**No Gantt.** A vertical list: phases as sections, work packages as rows with dates and progress, their own items pinned at the top. Same data, a layout that fits a 390px screen.

## 8 · What they never do
Open a Gantt · maintain a plan · type a percentage · enter a status twice · learn new software.

---

# PART 3 — The handshake

```
MIHIR / ALTUS (Projects)                 EMPLOYEE (Tasks)
────────────────────────                 ────────────────
Build plan → draw dependencies
Engine schedules around
  holidays + leave + weekly off
Set baseline
Assign  ────────────────────────────►    Task appears + notification
                                         Works it → marks Done
Progress rolls up  ◄─────────────────
Honesty line flags stale items
Something slipped?
  "This moves 6 tasks — apply?"
  You confirm  ─────────────────────►    New date + one notification
                                         Blocker cleared?
                                    ◄──  "You can start now"
```

**One deliberate action each side. No silent movement.**

---

# PART 4 — Charts

## You see
| Chart | Answers |
|---|---|
| **Attention list** | What's late, blocked, or slipped since yesterday? *(not a chart — and the most useful screen here)* |
| **Gantt** | What's the shape of the plan? |
| **Critical path** (outline + chain icon) | Which delays actually matter? |
| **Baseline ghost bars** | How far have we drifted? |
| **Workload grid** | Who's drowning, who's free? |
| **Project list health** | Which projects need me today? |
| **Honesty line** | Can I trust these numbers? |
| **Aging heatmap** ✅ | Which work is going stale? |
| **Status distribution** ✅ | Where is everything stuck? |

## They see
| Chart | Answers |
|---|---|
| **My Day counts** ✅ | What's due today, what's overdue? |
| **My tasks Kanban** ✅ | What am I working on? |
| **Project list (read-only)** 🔶 | Where does my work fit? |
| **Weekly goals** ✅ | What did I commit to? |

---

# PART 5 — Build order

Ordered by **what you actually ask daily**, not by what looks impressive. The Gantt is the most eye-catching screen but it answers only one of your four daily questions — and none of an employee's — so it is built *after* the plain lists that answer the rest.

| Phase | Ships | Answers | New library? |
|---|---|---|---|
| **1 · Foundations** | 3-level hierarchy · real dates · work-package↔task contract · derived progress · honesty line | *Do dates mean anything?* | none |
| **2 · Scheduling** | Working calendar · dependencies · float · critical path · **"you can start now"** | **Employee Q2.** The differentiator | none |
| **3 · Attention view** | Late / at-risk / blocked / slipped-since-yesterday | **Your Q1 + Q4.** Highest value per hour | none |
| **4 · Workload grid** | Real capacity from attendance + leave · overload | **Your Q2** | none (`dnd-kit` already installed) |
| **5 · Timeline** | Gantt · drag · calendar toggle · mobile list | **Your Q3** | frappe-gantt (MIT, no paid tier) |
| **6 · Baselines** | Freeze · ghost bars · variance | *How far have we drifted?* | none |
| **7 · Roll-up** | Project health · dashboard card · exports | Management view | none |

**Then stop and run two real projects before building more.**

**Phases 1–4 need no new dependency at all.** Ship 1–3 and you already have true dates, dependency awareness and a live "what needs attention" list — most of the daily value.

---

# 100% free — how

No paid components, no expiring free tiers, no revenue-capped community licences.

The trick is that **we build the scheduling engine ourselves.** Every commercial Gantt library charges for the same four things — working-days calendar, auto-scheduling, baselines, critical path — and all four are things we must build anyway, because a library's calendar knows about weekends and knows nothing about *your* holidays, *your* approved leave, or *your* per-person weekly-off.

So we need a library for one job only: **drawing bars and arrows.** Every paid feature is irrelevant to us.

**frappe-gantt** is the pick — MIT with **no paid tier at all**, so nobody has a commercial incentive to keep the free version weak. It's vanilla JS, so we write our own small React wrapper rather than lean on the third-party ones (all 1–4 years stale).

Everything else reuses what's already in your `package.json`: `dnd-kit` for drag, `recharts` for charts, `@tanstack/react-table` for grids.

*Caveat:* "free" means software licences. Supabase, Vercel, Firebase and Resend already have paid tiers at scale — this module adds negligible load at 9 users, but it isn't literally zero forever. **No new vendor is introduced.**

---

# Before any of this starts

Four decisions in [PLAN.md §14](./PLAN.md#14--decisions-needed-from-you). The one that changes the design most:

**Who plans?** At 9 people, realistically you. If every plan has to be built by the MD, this fails on adoption no matter how good the features are — and the planning UI must be built for **speed** (paste a list of names, keyboard, bulk-assign), not as a form-heavy wizard.
