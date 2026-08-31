import { GST_STATES } from "./gstin";
import type { LookupListKey } from "@/db/enums";

/**
 * The registry behind Client Master DD — one entry per editable dropdown
 * on the Client KYC form.
 *
 * Both the config screen and the KYC form resolve their options through here,
 * so there is a single source of truth: change a list in Client Master DD and
 * the form offers the new options on its next load.
 *
 * Storage is the app's existing `lookup_items` table for eleven of the twelve
 * lists — a generic master-list store, not a table per dropdown. Designation
 * is the exception: `customer_contacts.designation_id` is a foreign key into
 * `designations`, so that list has to stay where it is.
 *
 * `defaults` are suggestions, not seed data. A list with no saved rows reports
 * itself as DEFAULT and offers these; saving any option makes it CUSTOM. The
 * KYC form falls back to the same defaults, so a list nobody has configured
 * still renders a usable dropdown instead of an empty one.
 */

export const KYC_CATEGORIES = [
  "People",
  "Commercial Terms",
  "Banking",
  "Logistics",
  "Location & Currency",
] as const;
export type KycCategory = (typeof KYC_CATEGORIES)[number];

export interface KycListDef {
  key: KycListKey;
  label: string;
  category: KycCategory;
  /** Where on the KYC form this list appears — shown under the card title. */
  description: string;
  /** Large lists get their own search box inside the card. */
  searchable?: boolean;
  defaults: readonly string[];
  storage: "lookup" | "designations";
  /** The `lookup_items.list_key` this maps to. Absent for Designation. */
  lookupKey?: LookupListKey;
}

export type KycListKey =
  | "designation"
  | "kyc_payment_terms"
  | "freight_charges"
  | "credit_days"
  | "credit_limit"
  | "quantity_deviation"
  | "bank_account_type"
  | "bank_name"
  | "transporter"
  | "state"
  | "country"
  | "currency";

/* ── Default option sets ─────────────────────────────────────────────────── */

const DESIGNATIONS = [
  "Proprietor",
  "Director",
  "Partner",
  "CEO",
  "General Manager",
  "Purchase Manager",
  "Purchase Executive",
  "Procurement Head",
  "Managing Director",
  "Accounts Manager",
  "Production Manager",
  "Quality Head",
  "Owner",
] as const;

const PAYMENT_TERMS = [
  "100% Advance",
  "Against Delivery",
  "50% Advance, 50% on Delivery",
  "30 Days Credit",
  "45 Days Credit",
  "60 Days Credit",
  "As per PO",
] as const;

const FREIGHT_CHARGES = [
  "Paid by Customer",
  "Paid by Us",
  "Extra at Actuals",
  "Ex-Works",
  "Included",
] as const;

const CREDIT_DAYS = ["0", "7", "15", "30", "45", "90"] as const;

const CREDIT_LIMIT = ["1,00,00,000"] as const;

const QUANTITY_DEVIATION = ["±5%", "+/-2%", "+/-3%", "±10%", "As per PO", "0%"] as const;

const ACCOUNT_TYPES = [
  "Savings",
  "Current",
  "Cash Credit",
  "Overdraft",
  "NRE",
  "NRO",
  "FCNR",
  "Escrow",
] as const;

/** Scheduled commercial banks operating in India, public sector first. */
const BANK_NAMES = [
  "State Bank of India",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Indian Bank",
  "Indian Overseas Bank",
  "UCO Bank",
  "Bank of India",
  "Bank of Maharashtra",
  "Central Bank of India",
  "Punjab & Sind Bank",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "IndusInd Bank",
  "Yes Bank",
  "IDFC First Bank",
  "IDBI Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karur Vysya Bank",
  "City Union Bank",
  "Tamilnad Mercantile Bank",
  "Karnataka Bank",
  "RBL Bank",
  "Bandhan Bank",
  "DCB Bank",
  "CSB Bank",
  "Dhanlaxmi Bank",
  "Jammu & Kashmir Bank",
  "Nainital Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
  "Jana Small Finance Bank",
  "Suryoday Small Finance Bank",
  "ESAF Small Finance Bank",
  "Fincare Small Finance Bank",
  "Utkarsh Small Finance Bank",
  "Citibank",
  "HSBC",
  "Standard Chartered Bank",
  "Deutsche Bank",
  "DBS Bank India",
  "Barclays Bank",
  "BNP Paribas",
  "Bank of America",
  "JPMorgan Chase Bank",
  "MUFG Bank",
  "Saraswat Co-operative Bank",
  "Cosmos Co-operative Bank",
  "Shamrao Vithal Co-operative Bank",
  "Abhyudaya Co-operative Bank",
  "TJSB Sahakari Bank",
  "Bharat Co-operative Bank",
  "Janata Sahakari Bank",
] as const;

const TRANSPORTERS = [
  "Blue Dart",
  "DTDC",
  "VRL",
  "Gati",
  "Delhivery",
  "Professional Couriers",
  "Other",
] as const;

/** Countries JMT trades with, India first, then A–Z. */
const COUNTRIES = [
  "India",
  "Afghanistan", "Argentina", "Australia", "Austria", "Bahrain", "Bangladesh", "Belgium",
  "Bhutan", "Brazil", "Bulgaria", "Cambodia", "Canada", "Chile", "China", "Colombia",
  "Croatia", "Czech Republic", "Denmark", "Egypt", "Estonia", "Ethiopia", "Finland",
  "France", "Germany", "Ghana", "Greece", "Hong Kong", "Hungary", "Indonesia", "Iran",
  "Iraq", "Ireland", "Israel", "Italy", "Japan", "Jordan", "Kazakhstan", "Kenya",
  "Kuwait", "Latvia", "Lithuania", "Malaysia", "Maldives", "Mexico", "Morocco",
  "Mozambique", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nigeria", "Norway",
  "Oman", "Pakistan", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania",
  "Russia", "Saudi Arabia", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa",
  "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Taiwan", "Tanzania",
  "Thailand", "Turkey", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
  "United States", "Uzbekistan", "Vietnam", "Zambia", "Zimbabwe",
] as const;

/** ISO 4217 codes, the ones actually used in trade. INR first. */
const CURRENCIES = [
  "INR",
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD",
  "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN",
  "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF",
  "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS",
  "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS",
  "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW",
  "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA",
  "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
  "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN",
  "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD",
  "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT",
  "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES",
  "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWL",
] as const;

/* ── The registry ────────────────────────────────────────────────────────── */

export const KYC_LISTS: readonly KycListDef[] = [
  {
    key: "designation",
    label: "Designation",
    category: "People",
    description: "Contact person job titles.",
    defaults: DESIGNATIONS,
    storage: "designations",
  },
  {
    key: "kyc_payment_terms",
    label: "Payment Terms",
    category: "Commercial Terms",
    description: "Commercial & Credit → Payment Terms.",
    defaults: PAYMENT_TERMS,
    storage: "lookup",
    lookupKey: "kyc_payment_terms",
  },
  {
    key: "freight_charges",
    label: "Freight Charges",
    category: "Commercial Terms",
    description: "Commercial & Credit → Freight Charges.",
    defaults: FREIGHT_CHARGES,
    storage: "lookup",
    lookupKey: "freight_charges",
  },
  {
    key: "credit_days",
    label: "Credit Days",
    category: "Commercial Terms",
    description: "Commercial & Credit → Credit Days.",
    defaults: CREDIT_DAYS,
    storage: "lookup",
    lookupKey: "credit_days",
  },
  {
    key: "credit_limit",
    label: "Credit Limit",
    category: "Commercial Terms",
    description: "Commercial & Credit → Credit Limit.",
    defaults: CREDIT_LIMIT,
    storage: "lookup",
    lookupKey: "credit_limit",
  },
  {
    key: "quantity_deviation",
    label: "Quantity Deviation",
    category: "Commercial Terms",
    description: "Commercial & Credit → Quantity Deviation.",
    defaults: QUANTITY_DEVIATION,
    storage: "lookup",
    lookupKey: "quantity_deviation",
  },
  {
    key: "bank_account_type",
    label: "Account Type",
    category: "Banking",
    description: "Bank Details → Account Type.",
    defaults: ACCOUNT_TYPES,
    storage: "lookup",
    lookupKey: "bank_account_type",
  },
  {
    key: "bank_name",
    label: "Bank Name",
    category: "Banking",
    description: "Bank Details → Bank Name (searchable).",
    searchable: true,
    defaults: BANK_NAMES,
    storage: "lookup",
    lookupKey: "bank_name",
  },
  {
    key: "transporter",
    label: "Transporter",
    category: "Logistics",
    description: "Commercial & Credit → Transporter.",
    defaults: TRANSPORTERS,
    storage: "lookup",
    lookupKey: "transporter",
  },
  {
    key: "state",
    label: "State",
    category: "Location & Currency",
    description: "The State dropdown on client addresses.",
    searchable: true,
    // The official GST state list, already in the codebase for GSTIN → state.
    defaults: GST_STATES,
    storage: "lookup",
    lookupKey: "state",
  },
  {
    key: "country",
    label: "Country",
    category: "Location & Currency",
    description: "The Country dropdown (Registration & Tax + addresses).",
    searchable: true,
    defaults: COUNTRIES,
    storage: "lookup",
    lookupKey: "country",
  },
  {
    key: "currency",
    label: "Currency",
    category: "Location & Currency",
    description: "The Currency dropdown (Registration & Tax) - full ISO currency set.",
    searchable: true,
    defaults: CURRENCIES,
    storage: "lookup",
    lookupKey: "currency",
  },
];

/** One list's live state — saved options if any, otherwise the defaults. */
export interface ResolvedKycList {
  def: KycListDef;
  options: { id: string; label: string }[];
  /** True once the list has saved rows of its own. */
  customized: boolean;
}

/**
 * Pick what a list should show. Saved rows win; with none, the defaults stand
 * in as unsaved suggestions (ids prefixed `default:` so the UI can tell them
 * apart and keep them read-only).
 */
export function resolveKycList(
  def: KycListDef,
  saved: { id: string; label: string }[],
): ResolvedKycList {
  if (saved.length > 0) return { def, options: saved, customized: true };
  return {
    def,
    options: def.defaults.map((label, i) => ({ id: `default:${def.key}:${i}`, label })),
    customized: false,
  };
}
