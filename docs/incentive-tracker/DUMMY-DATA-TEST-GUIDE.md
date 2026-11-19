# Incentive Tracker A–G — dummy-data test guide

Written 2026-11-18 against the local code (uncommitted, on `main` at 2ff339b). Screen and field names are quoted from
the source. **Read section 0 before entering anything.**

## 0. Before any dummy record — prerequisites and what can't be undone

The existing app (`.env.local`, dev server on port 3000) is connected to **PRODUCTION** (fingerprint `ed679a28f0`).
Each item below needs your separate, exact approval:

| # | Prerequisite | Why | Reversible? |
|---|---|---|---|
| P1 | Apply 0134 (Category B) and then 0135 (C–G) to production | Without them B–G show "needs 0134 / 0135" and calculate nothing | Rollback scripts exist (they refuse once B–G data exists) |
| P2 | Test sign-ins: at least 5 people besides yourself (author, checker, runner/locker, approver, payer) plus 1–2 test salespeople | Maker-checker and separation of duties refuse one person doing two roles | **No.** "Invite employee" creates a Firebase login and emails it through Resend |
| P3 | Field Permissions (`/master-setup/access-control`) for those people: "Incentive Rules — …" and "Incentive Calculation — …", plus "Incentive Tracker — Log activity for an earlier month" if needed | Rights are never implied by admin status | Yes (set back to "Inherit"); the grant history stays |
| P4 | **Publishing** any configuration (any programme) | A published version of category X from month M makes the NEW engine authoritative for X from M for **every** employee: the old engine stops paying X to real salespeople from M. The deployed app already does this for Category A | **No.** Published versions are immutable and never deleted; a later real version can only supersede it |
| P5 | Calculating, locking, submitting, approving, recording payout | `incentive_calc_*` rows are append-only and periods are never deleted (database triggers) | **No** (only a DBA bypass of the triggers could remove them) |
| P6 | Forms documents (Tally Import, "Enter an order") | Production Forms is empty today (0 documents) | Rows can be deleted by SQL; no screen deletes them |
| P7 | D/E/F submissions by a test salesperson in the current month | The deployed app's daily `incentive-recompute` (10:30 IST) folds approved items into the old engine's open-month ledger and payout list | Partly: rejecting them and recomputing removes the ledger lines; audit rows stay |

Naming convention for every dummy record: prefix **`ZZTEST-`** (programme code `ZZTEST-A…G`, customers `ZZTEST Customer 1`,
document numbers `ZZTEST-SO-001`, references `ZZTEST-PAY-…`), dated in one agreed test month. Cleanup = delete by that
prefix (P6/P7 only), then verify with the read-only fingerprint script `scratchpad/audit/env-readonly.mjs` that every
genuine count is unchanged. P2, P4 and P5 can't be cleaned up.

## 1. Incentive Rules setup — `/master-setup/incentive-rules`
1. "New programme": "Code (capital letters, digits, - or _)" = `ZZTEST`, "Name" = `ZZTEST programme`, "Create programme".
2. On the programme: "New draft" → "Category" (e.g. `C · New Customer Acquisition – N / I / R`) → "Start from" = "The
   reference template — …" → "Create draft". Expected: the old engine's PDF values filled in; every undecided value empty.
3. Fill each section tab. For caps, the select offers "Not set" / "No limit" / "An amount". "Who this version covers":
   "Include", "By" = Employee, "Who" = your test salesperson, "From" = start of the test month.
4. "Save draft" with a change note. Expected: saved even while incomplete; "Submit for approval" refuses with
   "isn't complete: … isn't set" until every required value is chosen.

| Category | Sample values (TEST values, not business decisions) |
|---|---|
| C | look-back 24 months; transactions 3; turnover ₹2,50,000; amount "taxable"; rate 1%; most per customer ₹5,000; delay steps as the template |
| D | 10 leads per unit, ₹250; profiled only "yes"; 5 enquiries per unit, ₹250; counting "per submission" |
| E | smallest award ₹250; largest ₹1,000 |
| F | Google ₹100, ≥50 words, five-star only "yes", evidence "yes"; email ₹100; letterhead ₹150; named ×2 |
| G | **not testable**: every value is undecided (see the decision list) |
| all | monthly cap per the PDF or "No limit"; all-categories cap ₹18,250, "In proportion…"; approvals 1–2; release "after approval" |

## 2. Submit, independent approval, publish
5. Author: "Submit for approval". Expected: an author can't approve ("can't approve a version you created, edited or submitted").
6. Checker: "Approve" ("Note (optional)") or "Reject" ("Reason (required)"). A rejected version goes back to draft when edited.
7. Publisher: "Publish…" → "Effective from the month" = the test month → "Publish". **(P4: permanent.)** Expected refusals:
   an earlier month without "Publish from an earlier month"; any month the old engine already locked or paid for that
   category ("The old engine's Category X is already paid for 2026-07 … would pay Category X twice").

## 3. Masters and source documents
8. Customer Master `/forms/customer-master`: a customer `ZZTEST Customer 1` with "Sales Co-ordinator" = test salesperson
   (attribution) and "Credit Days" = 30. Sales Orders carry no salesperson; "Order salespeople" (Category A inputs) overrides.
9. Sales Orders `/forms/documents/sales-orders/import` → "Enter an order": "Voucher Number" `ZZTEST-SO-001`, "Voucher
   Date", customer from "Choose the customer from the Customer Master…", items ("Item Name", "Billed Quantity", "Item
   Rate", "Taxable Value") → "Check order" → import. For C: three orders of ₹1,00,000 taxable in three months.
10. Tally Import `/forms/tally-import` ("Upload" → "Column mapping" → "Validation" → "Preview" → "Import" → "Confirm import"):
    - Sales Invoices: "Document number", "Date", "Party name", "Total amount", "Taxable value", "Due date", **"Sales order reference"** = the SO number.
    - Customer Receipts: "Document number", "Date", "Party name", "Total amount", **"Invoice reference"**.
    - Credit Notes: …, **"Original invoice number"**, "Adjustment type".

## 4. Activity (D, E, F) — `/incentive/activity` → "Log activity"
11. As the test salesperson: Leads "Number of profiled leads" 25 + "Profiled" → "Submit leads"; another 40 unprofiled;
    Enquiries "Leads converted to valid enquiry" 11; Meeting "Potential" High, "Justification"; Review "Type" Google
    review, "Stars" 5, "Words" 60, "Evidence link"; Letterhead with "Names a teammate"; a Google review of 20 words.
    With the earlier-month permission, "Incentive month" appears (never a future month; refused for a locked/paid month).
12. As another admin: `/incentive/admin?tab=verify` → "Activity queue" → "Approve"/"Reject"; meetings take "Award ₹"
    (e.g. 1500). Expected: approving your own submission is refused ("You can't review your own submission…").

## 5. Calculation, shared cap, workflow — `/incentive/category/c` … `/f`, `/incentive/category-a`, `/incentive/category-b`
13. "Programme" = ZZTEST, "Month" = the test month → "Calculate". Expected (sample values above):
    C ₹3,000 (1% × ₹3,00,000, paid on time); D ₹1,000 (25 profiled → 2 × ₹250; 11 enquiries → 2 × ₹250);
    E ₹1,000 (₹1,500 award kept to the ₹1,000 maximum); F ₹400 (₹100 + ₹150 × 2; the 20-word review under "Not credited").
    Category A, from the tests: 12 orders of ₹10 L with the receipt delays of "example 2" → ₹925.
14. Shared cap: with an all-categories cap below the total, calculate E then F. Expected: E can't be submitted ("The other
    categories' figures … changed … reopen and recalculate it before submitting"). Reopen, "Calculate", lock, submit.
15. "Lock month" → "Submit for approval" → another person "Approve step N" (or "Reject" with "Reason (required to reject)").
    Expected: the submitter can't approve; one person can't approve two steps.
16. Payout ("Record payout"): "Payout reference" `ZZTEST-PAY-…`, "Paid on", "Amount paid ₹" (must equal the approved
    total), "Note (optional)". **A record only — the WMS moves no money (P5: permanent).**
17. Employee view `/incentive` and `/incentive/history` as the test salesperson: the category's amount appears only once
    approved or paid; another salesperson sees nothing of it.
18. Recalculation: change a source (e.g. a receipt), "Calculate" an open month → new run adopted; on a locked/approved/paid
    month the difference is carried to the next open month (shown under adjustments), the closed month unchanged.
19. Historical protection: the old engine's paid July 2026 stays untouched; publishing over it is refused (step 7).

## 6. Cleanup
20. Only P6/P7 records: reject leftover submissions; delete `ZZTEST-` Forms documents and customers by SQL under an
    approved script; recompute the affected open month; run the read-only fingerprint and compare with the pre-test copy.
