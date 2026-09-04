import { listEmployeeOptions } from "@/lib/queries/employees";
import {
  listActiveDepartmentOptions,
  listActiveDesignationOptions,
  listActiveProductOptions,
  listClientKycLookups,
  listKycDropdownOptions,
} from "@/lib/queries/client-kyc";
import type { ClientBulkOptions } from "@/lib/forms/client-bulk-columns";

/**
 * The option lists behind the Client Master bulk-import sheet.
 *
 * One loader for all three readers — the sheet that draws the dropdowns, the
 * .xlsx template that bakes them into a file, and the import that re-checks
 * every value on the way in. Three copies of this mapping would drift, and
 * the failure would be invisible: a template offering an option the import
 * then rejects.
 *
 * Every list comes from the loader the Client KYC form's own picker uses —
 * `listEmployeeOptions` for the roster, `listActiveProductOptions` for the
 * Product Types grid, the two lookup loaders for the admin-managed lists —
 * rather than from a query of this file's own. Re-querying `employees` and
 * `products` here would read the same rows a second time on a page that has
 * already loaded them, and would quietly stop matching the form the day
 * either loader changes what it considers pickable.
 */
export interface ClientBulkRosters {
  options: ClientBulkOptions;
  /** Sales person name (normalised) → employee id, for the import. */
  salesByName: Map<string, string>;
  /** Product name (normalised) → product id, for the import. */
  productsByName: Map<string, string>;
  /** Designation name (normalised) → id, for the contact blocks. */
  designationsByName: Map<string, string>;
  /** Department name (normalised) → id, for the contact blocks. */
  departmentsByName: Map<string, string>;
}

/** Normalised the same way `matchOption` compares — case and punctuation blind. */
const keyOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function listClientBulkOptions(): Promise<ClientBulkRosters> {
  const [lookups, dropdowns, productRows, salesRows, designationRows, departmentRows] =
    await Promise.all([
      listClientKycLookups(),
      listKycDropdownOptions(),
      listActiveProductOptions(),
      listEmployeeOptions(),
      // The Contact Person block's two pickers, from the loaders the KYC form
      // itself uses — a contact imported here must be one the form can show
      // back, which means the same two rosters and no others.
      listActiveDesignationOptions(),
      listActiveDepartmentOptions(),
    ]);

  const byName = (rows: { id: string; name: string }[]): Map<string, string> =>
    new Map(rows.map((r) => [keyOf(r.name), r.id]));

  return {
    options: {
      salesPeople: salesRows.map((r) => r.name),
      products: productRows.map((r) => r.name),
      customerTypes: lookups.customer_type,
      industryTypes: lookups.industry_type,
      gstRegistrationTypes: lookups.gst_registration_type,
      states: dropdowns.state,
      countries: dropdowns.country,
      currencies: dropdowns.currency,
      paymentTerms: dropdowns.kyc_payment_terms,
      freightCharges: dropdowns.freight_charges,
      transporters: dropdowns.transporter,
      quantityDeviations: dropdowns.quantity_deviation,
      designations: designationRows.map((r) => r.name),
      departments: departmentRows.map((r) => r.name),
      // Fixed sets — `optionsFor` serves these from the enum, not a list.
      contactTypes: [],
      addressTypes: [],
      grades: [],
      yesNo: [],
      activeStatus: [],
    },
    salesByName: byName(salesRows),
    productsByName: byName(productRows),
    designationsByName: byName(designationRows),
    departmentsByName: byName(departmentRows),
  };
}
