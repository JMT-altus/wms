# Targets & Forecasts — Plan

**For:** JMT Drive Solutions · **Status:** plan only, no code
**Module id:** `targets` · **Routes:** `/targets/*` · **Hub tile:** "Targets & Forecasts"

---

## 1 · Context

Sales planning at JMT currently has no home in the system. The annual turnover
target lives in someone's head or a spreadsheet, the monthly and weekly
breakdowns are re-derived by hand each cycle, and nobody can see — in one row —
what was **planned**, what the rep now **believes**, and what actually **came in**.

This module puts that one row on a screen. It mirrors the Goals module at
wms.mananvasa.com in shape (a period switcher, a list/kanban/dashboard triad,
per-period buckets) but is a *sales forecast*, not a generic goal tracker: the
rows are customers, the numbers are money, and the actuals come from Tally.

> **Note on the reference repo.** `github.com/MananVasa-support/Manan-Vasa` is
> public but contains no goals module — its directories are attendance,
> ecosystem, incentive, pso, social, task-management, work. The Goals module
> shown in the screenshots is not in that repository, so nothing was copied from
> it. This design comes from the screenshots, the meeting notes, and JMT's own
> existing conventions.

---

## 2 · Decisions taken (locked)

| Question | Decision |
|---|---|
| Forecast row grain | **Customer × period**, carrying Qty and Avg Rate |
| Customer dimension | **`customer_masters`** (Masters module), linked to `customers` for matching |
| Actual source | **Booked sales orders**, imported from a Tally export via bulk upload |
| Voice notes | **Dictation to text** — reuse the existing `DictateButton` |
| Target flow | **Top-down, then detail** — admin allocates, rep fills customer rows |
| Growth split | **Org default per FY, overridable per rep** |
| Q/M/W breakdown | **Auto-seed every level, always editable**, with a re-divide button |
| Visibility | **Own only; admins see all** |

---

## 3 · One thing I changed, and why

You chose "Actual = sales orders via bulk upload". Importing a Tally dump
**directly into `sales_orders` would silently change everybody's incentive
payout.** That table is the incentive engine's input: `logSale`
(`app/(app)/incentive/actions.ts:148`) writes it, and `computePeriodForEmployee`
recomputes accruals from it. A Tally dump would double-count against sales the
reps already logged by hand, and inflate real money.

**So: Tally actuals land in their own table, `forecast_actuals`**, shaped like a
sales order (customer, owner, value, booked date, source, import batch). Actual
is read from there. The incentive spine is untouched.

The forecast grid can *optionally* show the incentive-spine number beside it as
a reconciliation column — useful for spotting where rep-logged sales and Tally
disagree. Say the word if you'd rather feed `sales_orders` directly; it is a
one-line change of insert target, but I would not recommend it.

---

## 4 · Period model

Financial year **Apr–Mar**, reusing `fyForMonth()` from `lib/salary/period.ts:6`.

| Kind | Key format | Example | Count per FY |
|---|---|---|---|
| `annual` | `FY<startYear>` | `FY2026` | 1 |
| `quarter` | `<startYear>-Q<n>` | `2026-Q1` (Apr–Jun) | 4 |
| `month` | `YYYY-MM` | `2026-04` | 12 |
| `week` | Monday `yyyy-mm-dd` | `2026-04-06` | 52–53 |

Weeks are Monday-start and belong to the month containing their Monday, reusing
`mondayOf()` / `weekEnd()` / `formatWeekLabel()` from
`lib/weekly-goals/week.ts` — already IST-correct and unit-tested.

**Seeding cascade.** Annual ÷ 4 → quarters, quarter ÷ 3 → months, month ÷ 4 →
weeks. Every seeded value is editable; each level has a **↻ Re-divide** button
that re-seeds from its parent. A level whose children no longer sum to it shows
a quiet warning rather than blocking — seasonality is real and April is not
January.

---

## 5 · Data model

Five new tables, one new column, one migration (`0084_targets_forecasts.sql`).

### `forecast_targets` — the top-down allocation (admin-owned)
```
id, fy_start_year int, period_kind, period_key,
employee_id uuid NULL          -- NULL = company-level row
target_paise bigint
is_derived boolean             -- true until someone edits it
created_by_id, updated_by_id, created_at, updated_at
UNIQUE (fy_start_year, period_kind, period_key, employee_id)
```

### `forecast_growth_splits` — the 30 / 70 rule
```
id, fy_start_year int,
employee_id uuid NULL          -- NULL = the org default for that FY
existing_pct numeric(5,2)      -- new_pct is derived as 100 - existing_pct
```
One table rather than a column on `org_settings`, because the split is
per-financial-year and `org_settings` is a single row with no FY dimension.
Storing only `existing_pct` means the two halves can never disagree.

### `forecast_lines` — the heart: one customer, one period
```
id, fy_start_year, period_kind, period_key,
employee_id uuid NOT NULL,             -- the rep who owns this row
customer_master_id uuid NULL,          -- NULL only for the New Business row
is_new_business boolean DEFAULT false,
quantity numeric(14,2) NULL,
avg_rate_paise bigint NULL,
forecast_paise bigint NOT NULL,        -- qty × rate when both set, else typed
estimated_paise bigint NULL,
estimated_notes text NULL,
estimated_at timestamptz, estimated_by_id,
seeded_from_id uuid NULL,              -- provenance of a divided-down row
is_derived boolean,
created_by_id, updated_by_id, created_at, updated_at
```
Money is **integer paise** throughout, matching `lib/incentives/types.ts:5`.
Quantity is the only decimal.

### `forecast_actuals` — the Tally dump
```
id, customer_id uuid NULL,             -- FK into `customers`
customer_master_id uuid NULL,          -- resolved at import time
employee_id uuid NULL,
value_paise bigint NOT NULL,
booked_at date NOT NULL,
voucher_no text, product_ref text,
source text DEFAULT 'tally',
import_batch_id uuid → import_batches.id,
created_at
```

### `forecast_events` — append-only audit
Who changed which number, from what to what, when. Same shape as
`task_events` / `settings_events`, which the repo already uses for every
money-adjacent surface.

### One new column
`customer_masters.linked_customer_id uuid → customers.id` — the join that lets a
Tally actual find its forecast row. Resolved at import by `linked_customer_id`
first, then exact code, then normalised name; unmatched rows are **reported, not
guessed**, exactly like the unmatched-salesperson handling in
`lib/masters/bulk-parse.ts`.

---

## 6 · The screens

Left rail, mirroring the reference: **Annual · Quarterly · Monthly · Weekly ·
Dashboard · Hygiene**. The first four are one component parameterised by
`period_kind`, so a change to the grid lands on all four.

### 6.1 Forecast grid — the main screen

```
Targets & Forecasts                    [Search customers]        [+ Add customer]
‹  FY 2026-27  ›   ‹  Q1 Apr–Jun  ›              [↻ Re-divide]  [Bulk Upload] [Export]

  CUSTOMER          CAT      QTY   AVG RATE   FORECAST   ESTIMATED   ACTUAL    VAR    ACH%  ⋯
─────────────────────────────────────────────────────────────────────────────────────────────
  Shakti Engg       OEM(L)   120     ₹1,250    ₹1.50 L    ₹1.20 L   ₹1.35 L   -₹15 K   90%  ⋯
  Bharat Motors     Dealer    80     ₹2,000    ₹1.60 L    ₹1.80 L   ₹1.75 L   +₹15 K  109%  ⋯
  Panel Co          User      40     ₹1,500    ₹0.60 L    ₹0.55 L        —   -₹60 K    0%  ⋯
  ✦ New business      —        —          —    ₹3.00 L    ₹2.00 L   ₹1.10 L  -₹1.9 L   37%  ⋯
─────────────────────────────────────────────────────────────────────────────────────────────
  TOTAL                                        ₹6.70 L    ₹5.55 L   ₹4.20 L  -₹2.5 L   63%
  Allocated target ₹7.00 L · ₹30 K unplanned                        ⚠ 1 estimate has no note
```

**Columns, and why each earns its place**

| Column | Source | Editable by |
|---|---|---|
| Customer | `customer_masters` | picker; rep's own customers first |
| Cat | `customer_masters.customer_category` | read-only (set in Masters) |
| Qty | typed | gated on `forecast.quantity` (default **allowed**) |
| Avg Rate | typed | gated on `forecast.avg_rate` (default **denied** → admin only) |
| Forecast | `qty × rate`, or typed when either is blank | rep, until the period locks |
| Estimated | typed on the 27th / Friday routine | rep |
| Actual | derived from `forecast_actuals` | never — it is imported |
| Var | `actual − forecast` | derived |
| Ach% | `actual ÷ forecast` | derived |
| ⋯ | edit, add note, view history | — |

`forecast.quantity` and `forecast.avg_rate` **already exist** as permission keys
in `db/enums.ts:614-624`, seeded by migration 0081 and currently unused — the
admin matrix at `/master-setup/access-control` already renders them. Your "admins
should have edit option for Quantity and Average Rate" requirement needs *no new
permission machinery*, only wiring.

The **✦ New business** row is pinned last and is where the 70% acquisition
target lives. It has no customer by definition — that is the point of it.

### 6.2 Annual setup (once per FY, admin)

```
FY 2026-27 · Annual Forecast

  Company target        ₹12.00 Cr        Last FY actual  ₹9.20 Cr   (+30.4%)
  Growth split          Existing 30%  /  New 70%         [edit]

  SALESPERSON     LAST FY     ALLOCATED   EXISTING(30%)  NEW(70%)   PLANNED   GAP
  ─────────────────────────────────────────────────────────────────────────────────
  Altus Corp      ₹5.10 Cr    ₹5.00 Cr      ₹1.50 Cr    ₹3.50 Cr   ₹4.60 Cr  -₹40 L
  Rep 2           ₹4.10 Cr    ₹7.00 Cr      ₹2.10 Cr    ₹4.90 Cr   ₹7.05 Cr   +₹5 L
  ─────────────────────────────────────────────────────────────────────────────────
  TOTAL           ₹9.20 Cr   ₹12.00 Cr      ₹3.60 Cr    ₹8.40 Cr  ₹11.65 Cr  -₹35 L
```

*Allocated* is what the admin assigns. *Planned* is the sum of that rep's
customer rows. The **Gap** column is the whole reason for the top-down choice —
it makes an under-planned rep visible in April, not in March.

### 6.3 Update Estimates (the routine)

The 27th-of-month and Friday screens are the same grid with Forecast and Actual
read-only, and **Estimated + Notes** the only editable fields — so the routine is
a short, obvious task rather than a hunt across a wide table.

```
  Bharat Motors                     Forecast ₹1.60 L   Actual ₹1.75 L
  Estimated  [ ₹1,80,000        ]
  Notes      [ Confirmed 80 pcs for March, PO expected Fri   🎤 ]
                                                    [ Save ]  [ Save & next ]
```

The 🎤 is the existing `DictateButton` (`components/ui/dictate-button.tsx`) —
browser speech recognition, no external API, text lands in the field live.

### 6.4 Dashboard

Recharts, matching the existing dashboards:

- **FY progress** — Actual vs Estimated vs Forecast, as one horizontal bar
- **Quarter trend** — grouped bars, four quarters × three measures
- **Existing vs New** — stacked area across months, against the 30/70 plan
- **Top movers** — the ten customers with the largest positive and negative variance
- **Rep leaderboard** — admin only, achievement % by rep
- **Hygiene score** — one number, links through to §6.5

### 6.5 Hygiene tracker

Estimates submitted without a supporting note, plus periods that missed the
routine entirely.

```
  REP           PERIOD     ROWS   ESTIMATED   NO NOTE   ON TIME   HYGIENE
  Altus Corp    Apr 2026     14     14/14        3        ✓         79%
  Rep 2         Apr 2026     11      6/11        0        ✗ (2 d)   55%
```

Hygiene = filled estimates with notes ÷ total rows, with a penalty for a missed
deadline. Deliberately blunt: a number people can move.

---

## 7 · Cadence & reminders

`orgSettings` gains `forecastMonthlyDay` (default **27**) and
`forecastWeeklyDow` (default **5**, Friday) — policy, not constants, following
the training-policy precedent at `db/schema.ts:987`.

One cron route, `/api/cron/targets?job=…`, added to `vercel.json` alongside the
existing entries, reusing the `?job=` dispatch pattern of
`app/api/cron/weekly-goals/route.ts`:

| Job | Schedule (IST) | Does |
|---|---|---|
| `monthly-open` | 27th, 10:00 | "Your monthly estimates are due today" |
| `monthly-chase` | 28th, 10:00 | escalation to anyone still blank |
| `weekly-open` | Fri, 16:00 | "Update this week's estimates before you log out" |
| `weekly-chase` | Mon, 10:00 | escalation for last week |

Emails reuse `lib/email/resend.ts`; in-app notifications reuse
`lib/notifications/dispatch.ts` and the channel matrix, so WhatsApp/Slack routing
comes free.

**Locking.** A period locks 3 days after its deadline; after that only an admin
can edit, and the edit is written to `forecast_events`. Without this, "Forecasted
vs Actual" becomes meaningless — anyone can retro-fit the forecast to the result.

---

## 8 · Permissions

- Module `targets`, default **off**, grantable per person/department at
  `/admin/access` — same as `masters`.
- Reps read and write only rows where `employee_id = me.id`. Admins see all.
- Annual setup and allocation: **admin only**.
- `Avg Rate` column: gated on `forecast.avg_rate`, which already defaults to
  denied — so it is admin-only out of the box, exactly as asked.
- Server actions gate on the module grant (not `isAdmin`), matching
  `app/(masters-module)/masters/actions.ts` — the grant *is* the permission.

---

## 9 · What gets reused

| Need | Existing code |
|---|---|
| Week math, IST | `lib/weekly-goals/week.ts` |
| FY / month labels | `lib/salary/period.ts:6,20` |
| Table, filters, sort, export | `components/admin/master/data-table.tsx` (`title`/`sorts`/`tintHeader`/`exportLabel`) |
| Create/edit popup | `components/masters/masters-dialog.tsx` |
| Row ⋯ menu, status cell | `components/masters/row-menu.tsx` |
| Bulk upload + column mapping | `lib/masters/bulk-parse.ts`, `components/masters/bulk-upload.tsx` |
| Voice → text | `components/ui/dictate-button.tsx`, `lib/hooks/use-dictation.ts` |
| Field permissions | `lib/access/field-permissions.ts`, `lib/auth/field-access.ts` |
| Module registration | `lib/nav-modules.ts`, `lib/access/modules.ts`, `app/(app)/hub/page.tsx` |
| Cron dispatch | `app/api/cron/weekly-goals/route.ts` |
| Money formatting | `lib/format.ts` (`formatInrPaise`, `formatInrCompactPaise`) |

Genuinely new: the period cascade, the forecast/estimate/actual reconciliation,
the growth split, and the hygiene score.

---

## 10 · Build order

Each phase is independently shippable and useful on its own.

1. **Spine** — migration 0084, module registration, route group, sidebar, empty
   states. Nothing works yet but the module exists and is grantable.
2. **Annual setup** — company target, per-rep allocation, growth split.
3. **Forecast grid** — customer rows with Qty × Rate, the cascade and re-divide,
   field-permission gating on Avg Rate.
4. **Estimates + notes** — the update screen, dictation, period locking.
5. **Actuals** — `forecast_actuals`, the Tally bulk upload, matching and the
   unmatched-rows report.
6. **Dashboard + hygiene** — charts and the hygiene score.

Colour: navy panel with a **violet → blue** accent (`#7C3AED → #4F46E5`), kept in
one constant like `components/masters/theme.ts`. Distinct from WMS blue,
Employees green, Incentive indigo, Training cyan and Masters blue-teal — one
line to change if you'd prefer a different pairing.

---

## 11 · Verification

- Unit tests (pure, no DB) for: the period cascade and re-divide arithmetic,
  FY/quarter/month/week key generation and round-tripping, `qty × rate → paise`
  rounding, the growth split, hygiene scoring, and Tally row → customer matching
  including the ambiguous and unmatched cases.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` clean; new code lints clean.
- `next build` succeeds and all `/targets/*` routes appear.
- End-to-end in the browser: set an annual target → allocate to a rep → add
  three customer rows → re-divide to weeks → submit an estimate with a dictated
  note → upload a small Tally sample → confirm Actual lands **in the same row**
  and the unmatched report names the rows it could not place.
- Confirm the incentive module's numbers are **unchanged** after a Tally import.

---

## 12 · Still open

1. **A sample Tally export.** The column mapping is guesswork until I see one
   real file — voucher no, party name, item, qty, rate, value, date. A 20-row
   sample is enough.
2. **Last FY actuals.** The "+30.4% vs last year" framing needs FY 2025-26
   turnover per rep. Is that in Tally, or does it need a one-time import?
3. **Quantity units.** Is Qty in pieces, kg, or per-product UOM? `product_skus`
   has a `uom` column; at customer × period grain there is no product, so Qty is
   unitless unless you want a UOM field on the row.
4. **Who counts as "existing"?** I plan to use `customers.firstTransactionAt`
   before the FY start. Confirm that matches how you think about it.
