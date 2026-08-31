import {
  listActiveDepartmentOptions,
  listActiveDesignationOptions,
  listActiveProductOptions,
  listClientKycLookups,
  listKnownCities,
  listKycDropdownOptions,
  getClientKycDraft,
} from "@/lib/queries/client-kyc";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { allWithDbRetry } from "@/lib/db/retry";
import { ClientKycForm } from "@/components/forms/client-kyc-form";

/**
 * Create New Client KYC — one scrolling onboarding form.
 *
 * Every picker on the screen is fed from the master list it belongs to:
 * sales people from `employees`, the twelve dropdowns from `lookup_items`,
 * designations/departments from their own tables, Product Types from
 * `products`, and City suggestions from addresses already on record. Nothing
 * here is a hardcoded option list.
 *
 * The seven reads go through `allWithDbRetry` rather than a bare
 * `Promise.all`. They are tiny — ~11ms for all seven once warm — but they all
 * have to succeed for the page to render, so a single flaky connection used
 * to take the whole screen down with "We hit a snag". Retried individually,
 * one bad connection costs a few hundred milliseconds instead of the page.
 */
export default async function CreateClientKycPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  // `?draft=<id>` is the Draft list's Restore. Loaded on the server so the
  // form is filled on first paint rather than flashing empty and populating
  // — and so an id for something that is not a draft simply yields a blank
  // new-client form instead of an error page.
  const { draft: draftId } = await searchParams;
  const draft = draftId ? await getClientKycDraft(draftId) : null;

  const [lookups, dropdowns, products, salesPeople, designations, departments, cities] =
    await allWithDbRetry([
      ["kyc lookups", listClientKycLookups],
      // The lists Client Master DD owns. Resolved through the shared
      // registry, so a list nobody has configured still offers its defaults
      // instead of rendering empty.
      ["kyc dropdowns", listKycDropdownOptions],
      ["products", listActiveProductOptions],
      ["sales people", listEmployeeOptions],
      ["designations", listActiveDesignationOptions],
      ["departments", listActiveDepartmentOptions],
      ["known cities", listKnownCities],
    ] as const);

  return (
    <ClientKycForm
      salesPeople={salesPeople}
      lookups={lookups}
      dropdowns={dropdowns}
      designations={designations}
      departments={departments}
      productOptions={products}
      cityOptions={cities}
      draft={draft}
    />
  );
}
