# Incentive Tracker — Rebuild Plan

**Status:** Awaiting approval (Plan-first). No code written yet.
**Scheme source of truth:** `Incentive - Google Sheets.pdf` (the "Sales BH" scheme).
**Decision recap (from you):** rebuild the `/incentive` feature to the PDF scheme ·
destructive replace of the old one · build a real commercial data spine · plan first.

---

## 0 · The approach in one paragraph

Replace today's `/incentive` feature (schemes: `bss_conversion`, `sales_pitch`,
`client_happiness`, `group_intro`, plus project/sheet/weekly-goal ledger rows)
with a new **Incentive engine** that implements the PDF's Sales-BH scheme
(A sales-slabs · B cross-sell · C new-customer · D leads · E meetings ·
F reviews/testimonials · G retention) including the **collection-decay rule**.
It is fed by a **new commercial spine** (customers → orders → invoices → receipts)
so slab and decay math run on real data. Incentives are an **append-only ledger**
produced by a **pure, re-runnable rule engine**, with a provisional → locked →
paid period lifecycle. Naming is fixed too: the new engine becomes "Incentive
Tracker"; the receivables module stays "Outstanding" (today the nav mislabels it).

---

## 1 · Ground-truth corrections to the build brief

The brief (`incentive-tracker-build-prompt.md`) has stack details that do **not**
match this repo. The plan uses the **real** conventions:

| Brief said | Reality (what we'll use) |
|---|---|
| `app/(dashboard)/incentives/` | `app/(app)/incentive/` (route group `(app)`, folder singular) |
| "Supabase" data APIs | **Drizzle ORM** over `postgres-js` against Supabase **Postgres** (`DATABASE_URL`) |
| — | Auth is **Firebase** (employees.firebaseUid ↔ session) |
| npm | **pnpm** (`pnpm@10.33.0`) |
| `pnpm db:generate`/drizzle-kit | Migrations are **hand-written SQL** in `db/migrations/NNNN_*.sql`, applied by a filename-keyed applier (`pnpm db:migrate`). Editing an applied file won't re-run — new files only. A runtime `ensure-*-schema.ts` guard covers drift. |
| Next.js 16 | correct (16.2.6, RSC + server actions) |

**Consequence:** no `drizzle-kit generate`. Each schema change = a new numbered
SQL migration + Drizzle schema update + (where drift matters) a runtime ensure guard.

---

## 2 · What gets removed, and the coupling to rewire

Removing the current `/incentive` is destructive and touches 6 other places.
Delete + rewire list:

**Delete:**
- `app/(app)/incentive/{page.tsx,dashboard/page.tsx,actions.ts}`
- `components/incentive/*` (form-dialog, list, sync-button, dashboard, social-earner-setting)
- `lib/incentive-amount.ts`, `lib/incentive-fields.ts`, `lib/incentive-sheets.ts`,
  `lib/ensure-incentive-schema.ts`, `lib/queries/incentive.ts`
- `docs/incentive-appscript.gs`, `scripts/fix-incentive-columns.ts`
- Old table `incentive_requests` (data discarded, per your call) — via a new migration.

**Rewire (else the build breaks):**
- `components/projects/projects-workspace.tsx` — `ProjectIncentivePanel` + imports of
  `saveProjectIncentives`/`getProjectIncentives`. → Remove the panel (project-defined
  incentives aren't part of the Sales-BH scheme), or port to a manual discretionary award.
- `app/(app)/weekly-goals/actions.ts` — `setWeeklyGoalIncentive` writes a ledger row.
  → Drop the weekly-goal→incentive write, or map to a discretionary line.
- `lib/queries/weekly-goals.ts` — performance score reads `incentivesWon`. → Repoint to
  the new ledger (approved, non-reversed) or drop the term.
- `lib/queries/org-settings.ts` + `org_settings.incentive_social_earner` column → remove.
- `lib/nav-modules.ts` — move `/incentive` out of Employees; make it the "Incentive
  Tracker" module; relabel the receivables module "Outstanding".
- `db/enums.ts:248-270` — replace incentive enums with the new scheme's.

**Data migration:** old incentive data is discarded (your choice). The new
`weekly_goals.incentive*` columns can stay (harmless) or be dropped in the same migration.

---

## 3 · New data model (Drizzle `db/schema/incentives.ts` + SQL migrations)

**Commercial spine**
- `customers` — name, code, `acquisition_employee_id`, `first_transaction_at`,
  `fy_turnover_cache` (paise), derived `is_new_customer`.
- `sales_orders` — customer, owner(employee), `order_value_paise`, `category_code`
  enum `A|B|C|N|I|R|V`, product/brand refs, `booked_at`.
- `invoices` — order ref, `invoice_value_paise`, `invoice_date`, `agreed_terms_days`,
  `due_date` (generated), `is_first_invoice_for_customer`.
- `receipts` — invoice ref, `amount_paise`, `received_at`.
- `invoice_collection_state` — view/materialised: outstanding, `days_past_terms`,
  `decay_multiplier`, `fully_collected_at`.

**Activity spine**
- `lead_batches`, `lead_conversions`, `client_meetings` (potential band + admin award),
  `testimonials` (type `google_review|email|letterhead`, word_count, star_rating,
  names_employee, evidence_url, mentioned_employee_ids[]). All with approval state.

**Rule spine**
- `incentive_schemes`, `rule_versions` (immutable after publish), `rule_lines`
  (code A.1…G.2, type `marginal_slab|flat_percent|per_unit|discretionary|multiplier|streak`,
  JSONB `config` validated by a per-type zod schema, line/category caps, eligibility),
  `scheme_assignments` (employee↔scheme).

**Ledger spine**
- `incentive_periods` (month, `open|computing|review|locked|paid`),
- `incentive_ledger` (employee, period, rule_line_code, rule_version_id,
  entry_type `accrual|decay|clawback|discretionary|reversal|adjustment`,
  `amount_paise` **integer**, source_event_type/id, `explanation`, computed_at, created_by),
- `payout_runs`, `incentive_disputes`.

**Rules:** money in **integer paise**; rates as Postgres `numeric`; RLS mirroring the
existing `auth.jwt() ->> 'sub'` Firebase-UID pattern; seed data in `scripts/seed.ts`
(incl. one ~75-day-overdue invoice to exercise decay).

---

## 4 · Rule engine (`lib/incentives/`)

Pure function `evaluate(events, ruleVersion, asOfDate) → LineResult[]` — **no DB
writes**, unit-testable, re-runnable to reproduce any month.

```
lib/incentives/
  engine.ts        marginal-slab.ts  flat-percent.ts  per-unit.ts
  discretionary.ts multiplier.ts     streak.ts        collection.ts (decay)
  caps.ts          explain.ts        types.ts
```

**Cap cascade (fixed order, record where value is lost):** per-occurrence →
per-line → category (A 9,000 · B 1,500 · C 5,000 · D 1,000 · E 1,000 · F 750) →
scheme-monthly (18,250) → **decay multiplier applied last**, per source invoice.

**Ledger invariants:** immutable rows; corrections are reversing entries;
balance = `SUM(amount)`; recompute idempotent on `(employee, period, line, source_event)`;
rate changes mint a new `rule_version` (locked periods keep the old one).

**Explanation string is a feature:**
`A.2 · SALES SLAB — ₹1.34 Cr booked. Band ₹1.2–1.4 Cr at 0.15% on ₹14,00,000 = ₹2,100. Collection complete 12 Jul. Multiplier 1.00.`

**Vitest suite (`tests/incentives/`):** slab boundaries (0.99/1.0/1.2/1.6 Cr);
decay transitions (45/46, 75/76, 100/101); cap collisions; C.1 partial eligibility;
F.4 doubling vs F cap; idempotency; restatement produces a reversal not an edit;
golden-file month reproducing the PDF exactly.

---

## 5 · Screens

**Employee (`app/(app)/incentive/`)** — answers "earned? / at risk? / do next?":
earnings header (MTD ₹, provisional/locked/paid, headroom to 18,250) · category
progress rail (A–F, distance to next band) · **at-risk panel** with decay countdown
chips (`HALVES IN 4D`) + push at T-7/T-2 · submission flows (leads, meetings,
reviews/testimonials with evidence upload + the "never pressure for 5★" note) ·
ledger table with expandable explanations + `RAISE A QUERY` · statement PDF.

**Admin (`app/(app)/admin/incentive/` or in-module):** scheme builder (slab editor +
live payout curve, draft→publish mints a version, blocked on locked periods) ·
XLSX/CSV ingestion (reuse `import:legacy` pattern) · verification queue
(testimonials/leads/meetings, discretionary slider) · collection watchtower
(aging buckets with ₹ at risk) · period close (compute→review→lock→payout) ·
payroll handoff (one number, matches payslip) · analytics.

**Design:** existing display font/tokens, `formatINR` (lakh/crore) in `lib/format.ts`,
reuse status-colour palette, the decay countdown chip as the signature element,
mobile-usable at 375px, accessibility floor (focus, reduced-motion, text+colour).

---

## 6 · Delivery phases (each behind a feature flag, verified before the next)

| Phase | Scope | Done when |
|---|---|---|
| 0 · Teardown | Remove old `/incentive`, rewire the 6 couplings, keep app building + tests green | `pnpm build` + typecheck clean with old feature gone |
| 1 · Spine | Commercial + activity + rule + ledger schema, migrations, RLS, seed | `pnpm db:migrate && pnpm seed` yields a realistic incentive month |
| 2 · Engine | Pure `evaluate()` + all rule types + cap cascade + full Vitest incl. golden-file | Every §4 test green; PDF month reproduced exactly |
| 3 · Admin ingestion | XLSX import, manual entry, collection tracking | Admin loads a month of orders + receipts |
| 4 · Employee surface | Earnings, rail, at-risk, ledger | An employee can explain their own number |
| 5 · Submissions + verification | Evidence upload, triage queue, discretionary awards | E.1 + F.1–F.4 end to end |
| 6 · Close + payout | compute→review→lock→payout, payroll handoff, statement PDF | A month closes and lands on the payslip |
| 7 · Notifications + analytics | Push (decay T-7/T-2), email, Slack, admin dashboards | Decay warnings fire |

**Rule:** Phase 4 (showing numbers) does not merge before Phase 2's tests pass.

---

## 7 · The 10 scheme questions — my proposed defaults (confirm or correct)

These are genuine ambiguities in the sheet; wrong guesses = wrong payouts. I'll build
Phase 2 on these **defaults** unless you change them, all stored as editable config so
they're never hard-coded:

1. **Above ₹1.6 Cr** → *Default: cap at ₹9,000* (0.20% does not continue).
2. **Second slab grid (0.90–1.08 etc.)** → *Default: ignore as a target-scaled variant; the ₹1.0–1.6 Cr grid is live.*
3. **Unreconciled caps (8,000 on B, 2,000 on C)** → *Default: treat as spreadsheet artefacts; authoritative caps are the per-line Max-Upto totalling 18,250.*
4. **Section G (retention)** → *Default: leave undefined/disabled until you specify amount + reset rule.*
5. **Decay basis** → *Default: per-invoice against that invoice's own accruals.*
6. **"Collection issue" trigger** → *Default: any payment past agreed terms (not only disputes).*
7. **Reversal window** → *Default: if collected after being zeroed (>100d), incentive does NOT come back.*
8. **Scope** → *Default: scheme is a template assignable to a whole sales team, not one person.*
9. **Cap period** → *Default: monthly (A is explicitly monthly; others follow).*
10. **FY boundary** → *Default: Apr–Mar; a customer's "first 3 transactions / ₹2.5 L" status is tracked within the FY.*

---

## 8 · What I need from you to start

1. **Approve this plan** (or edit it).
2. **Confirm/correct the 10 defaults in §7** — I can start Phase 0/1 immediately and
   only need these locked before Phase 2 (the money math).
3. Confirm the **naming swap** is OK (new engine = "Incentive Tracker"; receivables = "Outstanding").
