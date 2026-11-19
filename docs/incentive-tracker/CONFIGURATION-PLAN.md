# Incentive Rules — configuration plan, Categories A–G

Generated 2026-11-18 from the app's settings catalogue (`lib/incentives/rules-config/spec.ts`), so every name below is exactly what Admin & Master Setup → Incentive Rules shows. **Nothing has been created, changed or published.** TEST · A v1's current values were read from production (read-only).

**Status:** Set = already in the draft · Template = the reference template fills it (old engine / PDF) — confirm it · Missing = no value anywhere.

**Your decision?** Yes = a business decision with no agreed value · Confirm = a value exists (PDF, April examples or template); confirm or change it · Decided = you already confirmed it (Category B Q1–Q20); enter it as decided.

Settings marked "(only when …)" are required only while another setting has the value shown. Every version also needs at least one row under "Who this version covers" (eligibility).

## Category A · Sales Order Received

Current draft: **TEST · Category A v1** (draft; production). It holds 9 settings, 3 slabs (A.1 ₹1.0 Cr – ₹1.2 Cr: ₹1,00,00,000–₹1,20,00,000, 0.1% (most ₹2,000); A.2 ₹1.2 Cr – ₹1.4 Cr: ₹1,20,00,000–₹1,40,00,000, 0.15% (most ₹3,000); A.3 ₹1.4 Cr – ₹1.6 Cr: ₹1,40,00,000–₹1,60,00,000, 0.2% (most ₹4,000)) and 4 delay steps (0–45 days: 100%; 45–75 days: 50%; 75–100 days: 25%; 100–∞ days: 0%), and no eligibility row. Don't edit it in place unless you decide to: a fresh draft from the reference template is the alternative.

Template slabs: A.1 ₹1.0 Cr – ₹1.2 Cr ₹1,00,00,000–₹1,20,00,000 0.1% (most ₹2,000); A.2 ₹1.2 Cr – ₹1.4 Cr ₹1,20,00,000–₹1,40,00,000 0.15% (most ₹3,000); A.3 ₹1.4 Cr – ₹1.6 Cr ₹1,40,00,000–₹1,60,00,000 0.2% (most ₹4,000).

Template delay steps: 0–45 days 100%; 45–75 days 50%; 75–100 days 25%; 100–∞ days 0%.

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| General Eligibility | Sales are counted from | — | — | Missing | **Yes** | Business decision |
| General Eligibility | Amount counted | — | — | Missing | **Yes** | Business decision |
| General Eligibility | Date that places a sale in a month | — | — | Missing | **Yes** | Business decision |
| General Eligibility | Orders left out | — | — | Missing | **Yes** | Business decision |
| General Eligibility | Pre-closed quantities | — | — | Missing | **Yes** | Business decision |
| Monthly Sales Thresholds | Monthly sales threshold | ₹1,00,00,000 | ₹1,00,00,000 | Set | Confirm | From the PDF |
| Monthly Sales Thresholds | Sales exactly at the threshold | — | — | Missing | **Yes** | Business decision |
| Incentive Slabs | How slabs are applied | Marginal (each slab on its own part) | Marginal (each slab on its own part) | Set | Confirm | From the April examples |
| Incentive Slabs | Slab edges | — | — | Missing | **Yes** | Business decision |
| Incentive Slabs | Sales above the highest slab | — | — | Missing | **Yes** | Business decision |
| Incentive Slabs | Fixed amount above the highest slab (only when "Sales above the highest slab" is fixedAmount) | — | — | Missing | **Yes** | Business decision |
| Incentive Slabs | Gaps between slabs | — | — | Missing | **Yes** | Business decision |
| Incentive Allocation | How the month's incentive is shared between orders | — | — | Missing | **Yes** | Business decision |
| Incentive Allocation | Orders that share the incentive | — | — | Missing | **Yes** | Business decision |
| Incentive Allocation | Minimum order value to take a share (only when "Orders that share the incentive" is onlyOrdersAboveMin) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Delay is counted from | Invoice due date (agreed terms) | Invoice due date (agreed terms) | Set | Confirm | From the PDF |
| Collection and Payment Delay | A payment exactly on a step's last day | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Where a due date comes from (only when "Delay is counted from" is invoiceDueDate) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Default days after the invoice (only when "Where a due date comes from" is defaultDays) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | When no due date can be found | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | After an amount has dropped to nil | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | How payments earn incentive | Each receipt at its own delay | Each receipt at its own delay | Set | Confirm | From the April examples |
| Partial Payment Rules | When earned incentive becomes payable | Only once the order is fully collected | Only once the order is fully collected | Set | Confirm | From the PDF |
| Partial Payment Rules | Amounts not yet received | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts not linked to an invoice (on account) | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts that pay several invoices | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Credit notes | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Sales returns | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Refunds | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Bounced cheques | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Reversed receipts | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Whose sale it is | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | When a customer's representative changes | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Shared credit | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | Calendar month | Calendar month | Set | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Where rounding happens | Once, on each salesperson's monthly total | Once, on each salesperson's monthly total | Set | Confirm | From the April examples |
| Rounding and Limits | Most one order can earn | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category A in a month | ₹9,000 | ₹9,000 | Set | Confirm | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | ₹18,250 | ₹18,250 | Set | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| General Eligibility | Orders that earn Category B (optional) | — | — | Missing | Decided | Confirmed decision |
| Rounding and Limits | Sharing the all-categories limit between categories (optional) | — | — | Missing | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |

## Category B · Old Customer – New Product / New Brand

No draft exists. Plan: a fresh draft from "The reference template".

Template delay steps: 0–45 days 100%; 45–75 days 50%; 75–100 days 25%; 100–∞ days 0%.

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| Category B Qualification | Orders left out | — | Cancelled orders | Template | Decided | Confirmed decision |
| Collection and Payment Delay | Delay is counted from | — | Invoice due date (agreed terms) | Template | Confirm | From the PDF |
| Collection and Payment Delay | A payment exactly on a step's last day | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Where a due date comes from (only when "Delay is counted from" is invoiceDueDate) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Default days after the invoice (only when "Where a due date comes from" is defaultDays) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | When no due date can be found | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | After an amount has dropped to nil | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | How payments earn incentive | — | Each receipt at its own delay | Template | Confirm | From the April examples |
| Partial Payment Rules | Amounts not yet received | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts not linked to an invoice (on account) | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts that pay several invoices | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Refunds | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Bounced cheques | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Reversed receipts | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | Adjust the difference in the current month | Template | Decided | Confirmed decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | Decided | Confirmed decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that recovery is allowed (only when "When recovery after payout stops" is afterWindowDays) | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Whose sale it is | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | When a customer's representative changes | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Shared credit | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | Calendar month | Template | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Where rounding happens | — | Once, on each salesperson's monthly total | Template | Confirm | Business decision |
| Rounding and Limits | Most one Sales Order can earn from Category B | — | — | Missing | Decided | Confirmed decision |
| Rounding and Limits | Most a salesperson can earn from Category B in a month | — | — | Missing | Decided | Confirmed decision |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | ₹18,250 | Template | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Category B Qualification | Existing customer: months looked back | — | 24 | Template | Decided | Confirmed decision |
| Category B Qualification | New product or brand: months looked back | — | The same months as the existing-customer look back | Template | Decided | Confirmed decision |
| Category B Qualification | New product or brand: its own months (only when "New product or brand: months looked back" is own) | — | — | Missing | **Yes** | Business decision |
| Category B Qualification | Minimum taxable value of one invoice | — | ₹1,00,000 | Template | Decided | Confirmed decision |
| Category B Qualification | Incentive rate | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Sales returns | — | Treated as a credit note (reassessed before payout, recovered after) | Template | Decided | Confirmed decision |
| Refunds and Adjustments | When recovery after payout stops | — | Never: recovered whenever it arrives | Template | Decided | Confirmed decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | In proportion to each category's amount | Template | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |

## Category C · New Customer Acquisition – N / I / R

No draft exists. Plan: a fresh draft from "The reference template".

Template delay steps: 0–45 days 100%; 45–75 days 50%; 75–100 days 25%; 100–∞ days 0%.

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| General Eligibility | Orders left out | — | Cancelled orders | Template | Confirm | Business decision |
| Collection and Payment Delay | Delay is counted from | — | Invoice due date (agreed terms) | Template | Confirm | From the PDF |
| Collection and Payment Delay | A payment exactly on a step's last day | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Where a due date comes from (only when "Delay is counted from" is invoiceDueDate) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | Default days after the invoice (only when "Where a due date comes from" is defaultDays) | — | — | Missing | **Yes** | Business decision |
| Collection and Payment Delay | When no due date can be found | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts not linked to an invoice (on account) | — | — | Missing | **Yes** | Business decision |
| Partial Payment Rules | Receipts that pay several invoices | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Refunds | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Bounced cheques | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Reversed receipts | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Whose sale it is | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | When a customer's representative changes | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Shared credit | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | Calendar month | Template | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most one new customer can earn | — | ₹5,000 | Template | Confirm | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category C in a month | — | ₹5,000 | Template | Confirm | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | ₹18,250 | Template | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | In proportion to each category's amount | Template | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |
| New Customer Rules | New customer: months with no earlier order | — | — | Missing | **Yes** | Business decision |
| New Customer Rules | Transactions that complete the acquisition | — | 3 | Template | Confirm | From the PDF |
| New Customer Rules | Financial-year turnover needed | — | ₹2,50,000 | Template | Confirm | From the PDF |
| New Customer Rules | Amount counted | — | — | Missing | **Yes** | Business decision |
| New Customer Rules | Incentive rate on the first transactions | — | 1% | Template | Confirm | From the PDF |

## Category D · New Customer Acquisition – C

No draft exists. Plan: a fresh draft from "The reference template".

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | Calendar month | Template | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category D in a month | — | ₹1,000 | Template | Confirm | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | ₹18,250 | Template | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | In proportion to each category's amount | Template | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |
| Reward Amounts | Profiled leads per reward | — | 10 | Template | Confirm | From the PDF |
| Reward Amounts | Reward per lead unit | — | ₹250 | Template | Confirm | From the PDF |
| Reward Amounts | Leads must be profiled | — | Only profiled batches | Template | Confirm | From the PDF |
| Reward Amounts | Leads turned into enquiries per reward | — | 5 | Template | Confirm | From the PDF |
| Reward Amounts | Reward per enquiry unit | — | ₹250 | Template | Confirm | From the PDF |
| Reward Amounts | How units are counted | — | — | Missing | **Yes** | Business decision |

## Category E · High Value / High Potential Client Meetings

Existing drafts **A2 · Category E v1 and v2** are empty (started from "Nothing"). Plan: a fresh draft from "The reference template" (left untouched until you decide).

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | Calendar month | Template | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category E in a month | — | ₹1,000 | Template | Confirm | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | ₹18,250 | Template | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | In proportion to each category's amount | Template | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |
| Reward Amounts | Smallest award for a meeting | — | ₹250 | Template | Confirm | From the PDF |
| Reward Amounts | Largest award for a meeting | — | ₹1,000 | Template | Confirm | From the PDF |

## Category F · Reviews / Testimonials

No draft exists. Plan: a fresh draft from "The reference template".

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | Calendar month | Template | Confirm | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category F in a month | — | ₹750 | Template | Confirm | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | ₹18,250 | Template | Confirm | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | In proportion to each category's amount | Template | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |
| Reward Amounts | Google review | — | ₹100 | Template | Confirm | From the PDF |
| Reward Amounts | Google review: fewest words | — | 50 | Template | Confirm | From the PDF |
| Reward Amounts | Google review: five stars only | — | Five stars only | Template | Confirm | From the PDF |
| Reward Amounts | Google review: evidence needed | — | — | Missing | **Yes** | Business decision |
| Reward Amounts | Email testimonial | — | ₹100 | Template | Confirm | From the PDF |
| Reward Amounts | Letterhead testimonial | — | ₹150 | Template | Confirm | From the PDF |
| Reward Amounts | When it names the salesperson or a teammate | — | 2 | Template | Confirm | From the PDF |

## Category G · Consecutive monthly customer purchases

No draft exists. Plan: a fresh draft (from "Nothing": G has no template).

| Section | Setting (as shown) | Current | Template | Status | Your decision? | Source |
|---|---|---|---|---|---|---|
| General Eligibility | Orders left out | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a month still open | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Changes affecting a locked or paid month | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | When adjustments make a month negative | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Months to carry a negative balance (only when "When adjustments make a month negative" is carryForwardMonths) | — | — | Missing | **Yes** | Business decision |
| Refunds and Adjustments | Days after payout that adjustments are allowed | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Whose sale it is | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | When a customer's representative changes | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Shared credit | — | — | Missing | **Yes** | Business decision |
| Salesperson Eligibility | Salespeople who leave | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Calculation period | — | — | Missing | **Yes** | From the PDF |
| Calculation Period | A month is recalculated until | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends (only when "A month is recalculated until" is fixedDaysAfterMonthEnd) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Locking a month | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Days after the month ends to lock (only when "Locking a month" is autoAfterDays) | — | — | Missing | **Yes** | Business decision |
| Calculation Period | Payments that arrive after a month is locked | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounding method | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Rounded to | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most one customer's run can earn | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Most a salesperson can earn from Category G in a month | — | — | Missing | **Yes** | From the PDF |
| Rounding and Limits | Most a salesperson can earn from all categories in a month | — | — | Missing | **Yes** | From the PDF |
| Approval and Payout Rules | Approvals before a payout | — | — | Missing | **Yes** | Business decision |
| Approval and Payout Rules | When an approved payout is released | — | — | Missing | **Yes** | Business decision |
| Rounding and Limits | Sharing the all-categories limit between categories | — | — | Missing | Decided | Confirmed decision |
| Rounding and Limits | Order the categories are filled in (only when "Sharing the all-categories limit between categories" is categoryOrder) | — | — | Missing | **Yes** | Business decision |
| Consecutive Purchases | Consecutive months of purchases | — | — | Missing | **Yes** | Business decision |
| Consecutive Purchases | Smallest purchase that counts for a month | — | — | Missing | **Yes** | Business decision |
| Consecutive Purchases | Amount counted | — | — | Missing | **Yes** | Business decision |
| Consecutive Purchases | Reward for a completed run | — | — | Missing | **Yes** | Business decision |
| Consecutive Purchases | After a reward | — | — | Missing | **Yes** | Business decision |

## Summary

| Category | Settings | Your decision (no value) | Confirm a value | Already decided |
|---|---|---|---|---|
| A | 57 | 46 | 9 | 2 |
| B | 46 | 30 | 5 | 11 |
| C | 40 | 30 | 9 | 1 |
| D | 26 | 17 | 8 | 1 |
| E | 22 | 16 | 5 | 1 |
| F | 27 | 17 | 9 | 1 |
| G | 30 | 29 | 0 | 1 |
