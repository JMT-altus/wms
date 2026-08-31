"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CornerDownRight,
  FileText,
  ImagePlus,
  PencilLine,
  Plus,
  Save,
  RotateCcw,
} from "lucide-react";
import {
  addKycDepartment,
  addKycDesignation,
  addKycLookupOption,
  attachClientKycFile,
  saveClientKyc,
  saveClientKycDraft,
  verifyGstin,
} from "@/app/(forms-module)/forms/client-kyc/actions";
import { saveMasterProduct } from "@/app/(masters-module)/masters/actions";
import { deriveStateFromGstin, isPlausibleGstin, panFromGstin } from "@/lib/masters/gstin";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import type { KycListKey } from "@/lib/masters/kyc-dropdowns";
import {
  CLIENT_ADDRESS_TYPES,
  CLIENT_ADDRESS_TYPE_LABELS,
  CLIENT_CONTACT_TYPES,
  CLIENT_CONTACT_TYPE_LABELS,
} from "@/db/enums";
import type { ClientAddressType, ClientContactType, LookupListKey } from "@/db/enums";
import {
  clearCurrentForm,
  readCurrentForm,
  saveCurrentForm,
} from "@/lib/masters/client-kyc-draft";
import { missingKycFields } from "@/lib/masters/kyc-completeness";
import type { EmployeeOption } from "@/lib/queries/employees";
import type {
  ClientKycDraftValues,
  KycLookupOptions,
  ProductOption,
  RosterOption,
} from "@/lib/queries/client-kyc";
import {
  AddBlockButton,
  AddPillButton,
  BlockHeader,
  CheckPill,
  KycField,
  KYC_ACCENT,
  RemoveButton,
  SectionCard,
  SelectControl,
  SuggestControl,
  TagControl,
  TextAreaControl,
  TextControl,
} from "./kyc/fields";

/**
 * Create New Client KYC — the whole onboarding form, one scrolling page.
 *
 * Seven cards in a fixed order (Identity → Registration & Tax → Contact Person
 * → Addresses → Commercial & Credit → Bank Details → Documents) over a single
 * flat form state that maps 1:1 onto `ClientKycSchema`. Everything selectable
 * is fed by a real master — `lookup_items` for the dropdowns, `employees` for
 * sales people, `designations`/`departments` for contacts, `products` for the
 * Product Types grid — so every "+ Add" writes to the list it belongs to
 * rather than inventing a form-local option nothing else can see.
 *
 * Documents are the one section gated on a save: `attachClientKycFile` needs a
 * `customerMasterId` to hang the row off, so uploads unlock once Onboard
 * Client has returned an id.
 */

const GRADES = ["A", "B", "C"] as const;
const YES_NO = ["Yes", "No"] as const;

/* ── Shape ───────────────────────────────────────────────────────────────── */

interface ContactRow {
  /**
   * Which of the three Contact Person groups this block is rendered in.
   * The rows stay one flat array so `setRow`/validation/submit keep working
   * on a single index; the section just filters by this when it draws.
   */
  contactType: ClientContactType;
  firstName: string;
  lastName: string;
  contactNo: string;
  email: string;
  designationId: string;
  departmentId: string;
  notes: string;
}

interface AddressRow {
  /** Which of the three Address groups this block is rendered in. */
  addressType: ClientAddressType;
  line1: string;
  line2: string;
  line3: string;
  line4: string;
  city: string;
  state: string;
  country: string;
  pinCode: string;
  /** Only the Invoice Mailing group collects this - see the section below. */
  email: string;
}

interface BankRow {
  accountName: string;
  bankName: string;
  accountNo: string;
  ifscSwift: string;
  branch: string;
  accountType: string;
  isPrimary: boolean;
}

interface FormState {
  /* Identity */
  gstin: string;
  name: string;
  salesRepId: string;
  exportClient: string;
  reference: string;
  grade: string;
  tags: string[];
  customerTypes: string[];
  industryTypes: string[];
  productIds: string[];
  /* Registration & Tax */
  panNo: string;
  msmeUdyamNo: string;
  gstRegistrationType: string;
  currency: string;
  country: string;
  state: string;
  tinNumber: string;
  iecNumber: string;
  website: string;
  testCertificateNeeded: string;
  tcsApplicable: string;
  /* Contacts / Addresses / Bank */
  contacts: ContactRow[];
  addresses: AddressRow[];
  bankAccounts: BankRow[];
  /* Commercial & Credit */
  paymentTerms: string;
  freightCharges: string;
  creditDays: string;
  creditLimit: string;
  transporter: string;
  quantityDeviation: string;
  otherReferences: string;
  notes: string;
}

const emptyContact = (contactType: ClientContactType): ContactRow => ({
  contactType,
  firstName: "",
  lastName: "",
  contactNo: "",
  email: "",
  designationId: "",
  departmentId: "",
  notes: "",
});

const emptyAddress = (addressType: ClientAddressType): AddressRow => ({
  addressType,
  line1: "",
  line2: "",
  line3: "",
  line4: "",
  city: "",
  state: "",
  country: "",
  pinCode: "",
  email: "",
});

const emptyBank = (isPrimary: boolean): BankRow => ({
  accountName: "",
  bankName: "",
  accountNo: "",
  ifscSwift: "",
  branch: "",
  accountType: "",
  isPrimary,
});

const EMPTY: FormState = {
  gstin: "",
  name: "",
  salesRepId: "",
  reference: "",
  exportClient: "",
  grade: "",
  tags: [],
  customerTypes: [],
  industryTypes: [],
  productIds: [],
  panNo: "",
  msmeUdyamNo: "",
  gstRegistrationType: "",
  currency: "",
  country: "",
  state: "",
  tinNumber: "",
  iecNumber: "",
  website: "",
  testCertificateNeeded: "",
  tcsApplicable: "",
  contacts: CLIENT_CONTACT_TYPES.map((t) => emptyContact(t)),
  addresses: CLIENT_ADDRESS_TYPES.map((t) => emptyAddress(t)),
  bankAccounts: [emptyBank(true)],
  paymentTerms: "",
  freightCharges: "",
  creditDays: "",
  creditLimit: "",
  transporter: "",
  quantityDeviation: "",
  otherReferences: "",
  notes: "",
};

/**
 * A saved draft, widened back into the shape the form edits.
 *
 * The stored children are only the rows that had something in them — the save
 * path drops untouched blanks — so each of the three groups is topped back up
 * to at least one empty block per type. Without that, restoring a draft that
 * never got a delivery address would render the Address section with no
 * delivery block at all, and the user would have no way to add one.
 */
function fromDraft(d: ClientKycDraftValues): FormState {
  const contacts = CLIENT_CONTACT_TYPES.flatMap((t) => {
    const mine = d.contacts.filter((c) => c.contactType === t);
    return mine.length > 0 ? mine : [emptyContact(t)];
  });
  const addresses = CLIENT_ADDRESS_TYPES.flatMap((t) => {
    const mine = d.addresses.filter((a) => a.addressType === t);
    return mine.length > 0 ? mine : [emptyAddress(t)];
  });
  return {
    ...EMPTY,
    ...d,
    contacts,
    addresses,
    bankAccounts: d.bankAccounts.length > 0 ? d.bankAccounts : [emptyBank(true)],
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Case-insensitive union keeping first-seen order — server options + optimistic adds. */
function merge(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...base, ...extra]) {
    const k = v.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/* ── Component ───────────────────────────────────────────────────────────── */

export function ClientKycForm({
  salesPeople,
  lookups,
  dropdowns,
  designations,
  departments,
  productOptions,
  cityOptions,
  draft,
}: {
  salesPeople: EmployeeOption[];
  lookups: KycLookupOptions;
  /** The lists Client Master DD owns, already resolved to labels. */
  dropdowns: Record<KycListKey, string[]>;
  designations: RosterOption[];
  departments: RosterOption[];
  productOptions: ProductOption[];
  cityOptions: string[];
  /**
   * A saved draft this form was opened to finish, from the Draft list's
   * Restore. Its presence switches the form from "create" to "finish this
   * one": saving updates that record instead of inserting a new client, and
   * the browser-local recovery draft is left strictly alone (see below).
   */
  draft?: ClientKycDraftValues | null;
}) {
  const router = useRouter();
  const [f, setF] = React.useState<FormState>(() => (draft ? fromDraft(draft) : EMPTY));
  const [pending, start] = React.useTransition();

  /**
   * The draft row this form currently owns — the one Restore opened, or the
   * one autosave created.
   *
   * State rather than a ref because the render tree depends on it: the
   * Documents tiles stay disabled until there is a record to attach to, and
   * the payload builder needs it so Save to Draft updates that row rather
   * than inserting a second one.
   *
   * Stored alongside the values in the browser copy, so a refresh keeps the
   * link to the draft as well as the data.
   */
  const [draftId, setDraftId] = React.useState<string | null>(draft?.id ?? null);

  /* Options added inline this session, merged over the server lists so a new
     pill is usable immediately rather than after the router refresh. */
  const [extra, setExtra] = React.useState<Record<string, string[]>>({});
  const [extraProducts, setExtraProducts] = React.useState<ProductOption[]>([]);
  const [extraRoster, setExtraRoster] = React.useState<{
    designations: RosterOption[];
    departments: RosterOption[];
  }>({ designations: [], departments: [] });

  const opts = (key: keyof KycLookupOptions) => merge(lookups[key], extra[key] ?? []);
  // Lists owned by Client Master DD resolve through the shared registry,
  // so an unconfigured list falls back to its defaults rather than empty.
  const dd = (key: KycListKey) => merge(dropdowns[key] ?? [], extra[key] ?? []);
  const allDesignations = [...designations, ...extraRoster.designations];
  const allDepartments = [...departments, ...extraRoster.departments];
  const products = React.useMemo(() => {
    const seen = new Set(productOptions.map((p) => p.id));
    return [...productOptions, ...extraProducts.filter((p) => !seen.has(p.id))];
  }, [productOptions, extraProducts]);

  /* ── Draft recovery ────────────────────────────────────────────────────── */

  const [restoredFrom, setRestoredFrom] = React.useState<string | null>(null);
  const hydrated = React.useRef(false);

  React.useEffect(() => {
    const local = readCurrentForm<FormState>();
    // Arriving from Restore. The server row seeded state already, and it wins
    // unless the browser copy belongs to this same draft — in which case that
    // copy is the newer one, holding edits made since the restore that a
    // refresh would otherwise roll back to the saved version. A copy carrying
    // a different id, or none, is a different half-typed client and must not
    // be pasted over this one.
    if (draft && local?.draftId !== draft.id) {
      hydrated.current = true;
      return;
    }
    if (local?.values) {
      const v = local.values;
      // The form is editing whichever draft the stored copy was linked to, so
      // Save to Draft updates that record instead of making another.
      setDraftId(local.draftId ?? null);
      setF({
        ...EMPTY,
        ...v,
        // A draft saved before the Contact Person section split into three
        // groups has rows with no `contactType`. Without this they would
        // match none of the three filters and vanish from the form while
        // still sitting in state - land them in Other, the same bucket
        // migration 0093 backfilled untyped rows to.
        contacts: (v.contacts ?? EMPTY.contacts).map((c) => ({
          ...c,
          contactType: CLIENT_CONTACT_TYPES.includes(c.contactType) ? c.contactType : "other",
        })),
        // Likewise for addresses: a draft from before the three-way split
        // holds the old "shipping" type, which now matches no group. It is
        // the same place under the old name, so it becomes a delivery
        // address - exactly what migration 0094 did to the stored rows.
        addresses: (v.addresses ?? EMPTY.addresses).map((a) => ({
          ...a,
          email: a.email ?? "",
          addressType: CLIENT_ADDRESS_TYPES.includes(a.addressType)
            ? a.addressType
            : "delivery",
        })),
      });
      setRestoredFrom(local.savedAt);
    }
    hydrated.current = true;
  }, [draft]);

  React.useEffect(() => {
    // Never write before the restore pass has run, or the empty initial state
    // would overwrite the work we are about to pick up.
    if (!hydrated.current) return;
    // Debounced rather than per-keystroke, and tagged with whichever draft
    // this form is editing so the copy can be read back safely.
    const t = setTimeout(() => saveCurrentForm(f, draftId), 400);
    return () => clearTimeout(t);
  }, [f, draftId]);

  /**
   * Empty the screen and forget the browser copy.
   *
   * Only ever the current form. Saved drafts are database rows and survive
   * this untouched — "Start fresh instead" clears what you are typing, it
   * does not throw away anything you deliberately saved.
   */
  function startFresh() {
    clearCurrentForm();
    setF(EMPTY);
    setDraftId(null);
    setRestoredFrom(null);
  }

  /* ── Setters ───────────────────────────────────────────────────────────── */

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const toggle = (k: "customerTypes" | "industryTypes" | "productIds", v: string) =>
    setF((p) => ({
      ...p,
      [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v],
    }));

  const setRow = <T,>(k: "contacts" | "addresses" | "bankAccounts", i: number, patch: Partial<T>) =>
    setF((p) => ({
      ...p,
      [k]: (p[k] as T[]).map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    }));

  const derivedState = deriveStateFromGstin(f.gstin);
  const gstinLooksOff = f.gstin.trim().length > 0 && !isPlausibleGstin(f.gstin);

  // The Registration & Tax State picker follows the GSTIN until it is touched,
  // so the two can't silently disagree on a fresh form.
  const effectiveState = f.state || derivedState || "";
  // Same rule as the state above: a GSTIN carries its holder's PAN in
  // characters 3-12, so typing one fills the PAN box for free. Anything typed
  // into the box itself wins — this only ever fills a blank, never overwrites.
  const derivedPan = panFromGstin(f.gstin);
  const effectivePan = f.panNo || derivedPan || "";

  /* ── Verify GSTIN ──────────────────────────────────────────────────────── */

  /**
   * The registry's answer for one particular GSTIN.
   *
   * `for` is what makes the status honest: it is stored against the number
   * that was checked, so editing the GSTIN afterwards makes the tick
   * disappear on its own rather than vouching for a number nobody verified.
   */
  const [verified, setVerified] = React.useState<{
    for: string;
    legalName: string | null;
    status: string | null;
  } | null>(null);
  const [verifying, setVerifying] = React.useState(false);

  const gstinNow = f.gstin.trim().toUpperCase();
  const verifiedNow = verified?.for === gstinNow ? verified : null;

  /**
   * Fill a box from the registry without overwriting the user.
   *
   * Only ever writes into an empty field: someone who has already typed a
   * company name meant it, and a lookup they asked for is not a reason to
   * replace their work. Company Name is the exception — see below.
   */
  function fillIfBlank<K extends keyof FormState>(key: K, value: string | null) {
    if (!value) return;
    setF((p) => (String(p[key] ?? "").trim() === "" ? { ...p, [key]: value } : p));
  }

  function runVerifyGstin() {
    if (verifying) return;
    if (!isPlausibleGstin(gstinNow)) {
      toast.error("Enter a valid GSTIN.");
      return;
    }
    setVerifying(true);
    void verifyGstin(gstinNow)
      .then((res) => {
        if (!res.ok) {
          // Nothing is cleared and nothing is filled — the form is exactly as
          // the user left it, which is the whole point on a failed lookup.
          setVerified(null);
          toast.error(res.error);
          return;
        }
        const d = res.data;
        setVerified({ for: gstinNow, legalName: d.legalName, status: d.status });

        // Company Name is the one field the registry outranks: it is the
        // legal name on the registration, and it is what the rest of the
        // record has to match. Still editable afterwards like any other box.
        if (d.legalName) setF((p) => ({ ...p, name: d.legalName! }));

        fillIfBlank("panNo", d.pan);
        fillIfBlank("state", d.state);
        fillIfBlank("gstRegistrationType", d.taxpayerType);

        // The principal place of business goes to the billing address, and
        // only into blanks — the same rule, applied block by block.
        const a = d.addressParts;
        if (a.line1 || a.line2 || a.city || a.pinCode) {
          setF((p) => {
            const i = p.addresses.findIndex((x) => x.addressType === "billing");
            if (i === -1) return p;
            const row = p.addresses[i]!;
            const keep = (cur: string, next: string | null) => (cur.trim() === "" && next ? next : cur);
            const next = {
              ...row,
              line1: keep(row.line1, a.line1),
              line2: keep(row.line2, a.line2),
              city: keep(row.city, a.city),
              state: keep(row.state, a.state),
              pinCode: keep(row.pinCode, a.pinCode),
            };
            const addresses = [...p.addresses];
            addresses[i] = next;
            return { ...p, addresses };
          });
        }

        toast.success(
          d.legalName ? `GSTIN verified — ${d.legalName}` : "GSTIN verified.",
          { duration: 6000 },
        );
      })
      .catch(() =>
        toast.error("GST verification is temporarily unavailable. Please try again."),
      )
      .finally(() => setVerifying(false));
  }

  /* ── Inline "+ Add" writes ─────────────────────────────────────────────── */

  // Keyed by the lookup list, not just the ones this form loads eagerly, so
  // the registry-backed lists (credit_limit, state) can use it too.
  function addLookup(key: LookupListKey, label: string, select?: (v: string) => void) {
    start(async () => {
      const res = await addKycLookupOption(key, label);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setExtra((p) => ({ ...p, [key]: [...(p[key] ?? []), label] }));
      select?.(label);
      toast.success(`"${label}" added.`);
      router.refresh();
    });
  }

  function addRoster(kind: "designations" | "departments", name: string, i: number) {
    start(async () => {
      const res =
        kind === "designations" ? await addKycDesignation(name) : await addKycDepartment(name);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.id) {
        const row = { id: res.id, name };
        setExtraRoster((p) => ({ ...p, [kind]: [...p[kind], row] }));
        setRow<ContactRow>("contacts", i,
          kind === "designations" ? { designationId: res.id } : { departmentId: res.id });
      }
      toast.success(`"${name}" added.`);
      router.refresh();
    });
  }

  function addProduct(name: string) {
    start(async () => {
      const res = await saveMasterProduct(null, { name });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.id) {
        setExtraProducts((p) => [...p, { id: res.id!, name, categoryId: null }]);
        setF((p) => ({ ...p, productIds: [...p.productIds, res.id!] }));
      }
      toast.success(`"${name}" added to Product Master.`);
      router.refresh();
    });
  }

  /**
   * What this form still needs before it can be onboarded, live.
   *
   * The very same `missingKycFields` the save path and the Draft list use, so
   * the checklist can never disagree with the decision the server actually
   * makes. Previously the only way to discover any of this was to press
   * Onboard Client and read it off the "Saved to Draft — still needs …"
   * toast, which is late: the user has left the form by then.
   */
  const missingNow = React.useMemo(
    () =>
      missingKycFields({
        name: f.name,
        gstin: f.gstin,
        panNo: effectivePan,
        salesRepId: f.salesRepId,
        contacts: f.contacts,
        addresses: f.addresses,
      }),
    [f, effectivePan],
  );

  /* ── Saving ────────────────────────────────────────────────────────────── */

  function buildPayload() {
    return   {
          // The draft row this form owns — the one Restore opened, or the one
          // autosave created. Sending it is what makes Save update that
          // record; sending null here would leave the autosaved draft behind
          // and insert a second copy of the same client alongside it.
          id: draftId,
          name: f.name,
          gstin: f.gstin,
          state: effectiveState,
          salesRepId: f.salesRepId,
          grade: f.grade === "" ? null : f.grade,
          exportClient: f.exportClient,
          tags: f.tags,
          customerTypes: f.customerTypes,
          industryTypes: f.industryTypes,
          productIds: f.productIds,
          panNo: effectivePan,
          msmeUdyamNo: f.msmeUdyamNo,
          gstRegistrationType: f.gstRegistrationType,
          currency: f.currency,
          country: f.country,
          reference: f.reference,
          tinNumber: f.tinNumber,
          iecNumber: f.iecNumber,
          website: f.website,
          testCertificateNeeded: f.testCertificateNeeded,
          tcsApplicable: f.tcsApplicable,
          // Blank rows are dropped rather than saved as empty children — a
          // contact with no name at all is the untouched default, not data.
          contacts: f.contacts
            .filter((c) => c.firstName || c.lastName || c.contactNo || c.email || c.notes)
            .map((c) => ({ ...c, designationId: c.designationId, departmentId: c.departmentId })),
          addresses: f.addresses.filter((a) => a.line1 || a.city || a.pinCode || a.email),
          bankAccounts: f.bankAccounts.filter((b) => b.accountName || b.accountNo || b.bankName),
          paymentTerms: f.paymentTerms,
          freightCharges: f.freightCharges,
          creditDays: f.creditDays,
          // "1,00,00,000" is how a lakh-crore figure gets typed here; Number()
          // would make that NaN and trip the validator over formatting alone.
          creditLimit: f.creditLimit.replace(/,/g, ""),
          transporter: f.transporter,
          quantityDeviation: f.quantityDeviation,
          otherReferences: f.otherReferences,
          notes: f.notes,
        };
  }

  /* ── Submit ────────────────────────────────────────────────────────────── */

  /**
   * The field-level checks both buttons share.
   *
   * Format only — "this is not an email address" — never completeness. What a
   * record still *needs* is the completeness rule's job, and the two buttons
   * answer that question differently: a draft is allowed to be unfinished,
   * onboarding is not.
   */
  function formatErrors(): string | null {
    if (!f.name.trim()) return "Company name is required.";
    const badEmail = f.contacts.find((c) => c.email.trim() && !EMAIL_RE.test(c.email.trim()));
    if (badEmail) return `"${badEmail.email}" is not a valid email address.`;
    if (effectivePan.trim() && !PAN_RE.test(effectivePan.trim().toUpperCase())) {
      return "PAN should be 5 letters, 4 digits, then a letter — e.g. ABCDE1234F.";
    }
    const badMailTo = f.addresses.find((a) => a.email.trim() && !EMAIL_RE.test(a.email.trim()));
    if (badMailTo) return `"${badMailTo.email}" is not a valid email address.`;
    const badPin = f.addresses.find((a) => a.pinCode.trim() && !/^\d{6}$/.test(a.pinCode.trim()));
    if (badPin) return "Pin code should be 6 digits.";
    return null;
  }

  /**
   * Hand the record over and clear the screen for the next client.
   *
   * Called only after the server has confirmed the write. Everything goes
   * together — the values, the browser copy, the link to the draft — because
   * a form still showing a record it no longer owns is how the same client
   * ends up saved twice.
   */
  function releaseForm() {
    clearCurrentForm();
    setF(EMPTY);
    setDraftId(null);
    setRestoredFrom(null);
  }

  /**
   * The record a document attaches to.
   *
   * Documents need a client to hang off, and until Save to Draft there is no
   * row — which used to leave the tiles inert at exactly the moment someone
   * has a business card in their hand. Clicking one now saves the draft
   * first, so the click does something instead of nothing.
   *
   * This is not autosave: it happens because the user clicked Add, and it
   * deliberately does NOT clear the form the way the Save to Draft button
   * does — they are in the middle of filling it in.
   */
  const attachId = draftId;

  async function ensureAttachTarget(): Promise<string | null> {
    if (attachId) return attachId;
    const bad = formatErrors();
    if (bad) {
      toast.error(bad);
      return null;
    }
    try {
      const res = await saveClientKycDraft(buildPayload());
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      if (!res.draftId) return null;
      setDraftId(res.draftId);
      toast.success("Saved as a draft so the file has a client to attach to.");
      router.refresh();
      return res.draftId;
    } catch {
      toast.error("Couldn't reach the server. Try again in a moment.");
      return null;
    }
  }

  /**
   * Save to Draft — keep the work without claiming it is finished.
   *
   * Company Name is the only requirement, matching the form's single `*`. A
   * draft that demanded a complete KYC would be a contradiction.
   */
  function saveToDraft() {
    const bad = formatErrors();
    if (bad) return toast.error(bad);

    start(async () => {
      try {
        const res = await saveClientKycDraft(buildPayload());
        if (!res.ok) {
          // The form is left exactly as it is. Nothing was stored, so
          // clearing the screen here would be destroying the only copy.
          toast.error(res.error);
          return;
        }
        releaseForm();
        toast.success("Draft saved successfully.");
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server — your work is still here. Try again in a moment.");
      }
    });
  }

  /**
   * Onboard Client — the permanent submission.
   *
   * Unlike Save to Draft this demands a complete record, and refuses rather
   * than quietly filing an incomplete one as a draft: the user asked for a
   * client, and silently doing something else is how a record ends up
   * somewhere nobody goes looking for it.
   */
  function onboard() {
    const bad = formatErrors();
    if (bad) return toast.error(bad);
    if (missingNow.length > 0) {
      toast.error(`Can't onboard yet — still needs ${missingNow.join(", ")}.`, { duration: 8000 });
      return;
    }

    start(async () => {
      try {
        const res = await saveClientKyc(buildPayload());
        if (!res.ok) {
          // Network, validation or database failure. The form keeps every
          // value and the draft behind it is untouched, so the fix is to
          // press the button again.
          toast.error(res.error);
          return;
        }
        // Belt and braces: the client-side check above should have caught
        // this, but the server owns the rule and gets the last word.
        if (res.draft) {
          toast.error(`Saved as a draft — still needs ${(res.missing ?? []).join(", ")}.`, {
            duration: 8000,
          });
          releaseForm();
          router.refresh();
          return;
        }
        releaseForm();
        toast.success("Client onboarded successfully.");
        router.refresh();
      } catch {
        toast.error("Couldn't reach the server — your work is still here. Try again in a moment.");
      }
    });
  }

  // Ctrl/⌘ + Enter saves from anywhere on the page, as the action bar
  // advertises. The listener is bound once and reads the newest `onboard`
  // through a ref, so it always submits current state without rebinding on
  // every keystroke.
  const submitRef = React.useRef(onboard);
  React.useEffect(() => {
    submitRef.current = onboard;
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className="kyc-form flex flex-col gap-4 pb-4">
      {/* Header row, matching the six table screens: the page's name on the
          left, Full screen on the right. This form had no header at all — the
          only thing naming it was the sidebar — so the button had nowhere to
          live and the screen looked unrelated to the rest of the module. */}
      <div className="flex items-center gap-3 flex-nowrap max-md:flex-wrap max-md:gap-y-2">
        <h1
          className="flex-1 min-w-0 font-bold text-ink-strong"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontSize: "clamp(19px, 1.9vw, 26px)",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Create New Client KYC
        </h1>
        <FullscreenToggle />
      </div>

      {/* Restore mode. Without this the form is indistinguishable from a new
          one, and "Onboard Client" would look like it is creating a second
          record when it is really finishing this draft in place. */}
      {draft && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg px-4 py-2.5"
          style={{
            fontSize: 13.5,
            background: "color-mix(in srgb, var(--color-indigo) 6%, var(--color-surface-card))",
            border: "1px solid color-mix(in srgb, var(--color-indigo) 22%, transparent)",
          }}
        >
          <PencilLine
            size={15}
            strokeWidth={2.2}
            className="shrink-0"
            style={{ color: KYC_ACCENT }}
          />
          <span className="text-ink-soft">
            Finishing the draft for{" "}
            <strong className="text-ink-strong">{draft.name}</strong>
            {draft.code ? (
              <>
                {" "}
                <span className="text-ink-subtle">({draft.code})</span>
              </>
            ) : null}{" "}
            — saving updates this record, it will not create a new one.
          </span>
          <a
            href="/forms/client-kyc/drafts"
            className="font-semibold underline underline-offset-2"
            style={{ color: KYC_ACCENT }}
          >
            Back to Draft
          </a>
        </div>
      )}

      {restoredFrom && (
        <div
          className="flex items-center gap-2 rounded-lg px-4 py-2.5"
          style={{
            fontSize: 13.5,
            background: "color-mix(in srgb, var(--color-indigo) 6%, var(--color-surface-card))",
            border: "1px solid color-mix(in srgb, var(--color-indigo) 22%, transparent)",
          }}
        >
          <RotateCcw size={15} strokeWidth={2.2} className="shrink-0" style={{ color: KYC_ACCENT }} />
          <span className="text-ink-soft">
            Picked up your unsaved work from{" "}
            <strong className="text-ink-strong">{formatSavedAt(restoredFrom)}</strong>
          </span>
          <span className="text-ink-subtle">·</span>
          <button
            type="button"
            onClick={startFresh}
            className="font-semibold underline underline-offset-2"
            style={{ color: KYC_ACCENT }}
          >
            Start fresh instead
          </button>
        </div>
      )}

      {/* ── 1. Identity ─────────────────────────────────────────────────── */}
      <SectionCard
        title="Identity"
        subtitle="Who the client is - type, industry and the products they buy."
      >
        <div className="grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-12">
          {/* Row 1 - the three spans below fill all 12 columns, which is what
              keeps the four fields after them on a second line. Company Name
              and Reference share a span so the two boxes match in width. */}
          <div className="lg:col-span-4">
            <KycField
              label="GSTIN"
              error={gstinLooksOff ? "Doesn't look like a 15-character GSTIN." : null}
              hint={
                verifiedNow
                  ? `✓ Verified${verifiedNow.status ? ` · ${verifiedNow.status}` : ""}`
                  : undefined
              }
            >
              <div className="flex items-stretch gap-2">
                <TextControl
                  value={f.gstin}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                  placeholder="27ABCDE1234F1Z5"
                  maxLength={20}
                  invalid={gstinLooksOff}
                />
                {/* Only ever on click — never on change, never on a re-render.
                    A lookup per keystroke would be a request for every prefix
                    of the number and would burn the quota on nonsense. */}
                <button
                  type="button"
                  onClick={runVerifyGstin}
                  disabled={verifying || !isPlausibleGstin(gstinNow)}
                  title={
                    isPlausibleGstin(gstinNow)
                      ? "Look this GSTIN up in the GST registry"
                      : "Enter a full 15-character GSTIN first"
                  }
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 h-11 font-semibold text-ink-soft bg-surface-card disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                  style={{ fontSize: 12.5, border: "1px solid var(--color-hairline-strong)" }}
                >
                  {verifying ? (
                    "Verifying…"
                  ) : verifiedNow ? (
                    <>
                      <Check size={13} strokeWidth={3} style={{ color: KYC_ACCENT }} />
                      Verified
                    </>
                  ) : (
                    "Verify GSTIN"
                  )}
                </button>
              </div>
            </KycField>
          </div>
          <div className="lg:col-span-4">
            <KycField label="Company Name" required>
              <TextControl
                value={f.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Registered company name"
                maxLength={200}
              />
            </KycField>
          </div>
          <div className="lg:col-span-4">
            <KycField label="Reference">
              <TextControl
                value={f.reference}
                onChange={(e) => set("reference", e.target.value)}
                placeholder="Who referred this client"
                maxLength={200}
              />
            </KycField>
          </div>
          {/* Row 2 — 5+3+4 fills the 12 columns. Export used to sit here and
              took 3 with it when it moved to Export Details; without this the
              row would end in a gap the width of the missing field. */}
          <div className="lg:col-span-5">
            <KycField label="Assign Sales Co-ordinator" required>
              <select
                value={f.salesRepId}
                onChange={(e) => set("salesRepId", e.target.value)}
                className="w-full rounded-lg h-11 px-3 bg-surface-card border outline-none text-[14px] text-ink-strong appearance-none pr-8"
                style={{
                  borderColor: "var(--color-hairline-strong)",
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                  backgroundPosition: "right 10px center",
                  backgroundRepeat: "no-repeat",
                }}
              >
                <option value="">— unassigned —</option>
                {salesPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </KycField>
          </div>
          <div className="lg:col-span-3">
            <KycField label="Grade">
              <SelectControl
                value={f.grade}
                onChange={(e) => set("grade", e.target.value)}
                options={GRADES}
              />
            </KycField>
          </div>
          <div className="lg:col-span-4">
            <KycField label="Tags">
              <TagControl
                values={f.tags}
                onChange={(v) => set("tags", v)}
                placeholder="e.g. Mining, Defense"
              />
            </KycField>
          </div>
        </div>

        <p className="mt-3 text-ink-subtle" style={{ fontSize: 12.5 }}>
          State:{" "}
          <strong className="text-ink-strong">
            {derivedState ?? "— enter a GSTIN to derive —"}
          </strong>
        </p>

        <PillRow
          label="Customer Type"
          options={opts("customer_type")}
          selected={f.customerTypes}
          onToggle={(v) => toggle("customerTypes", v)}
          onAdd={(v) =>
            addLookup("customer_type", v, (label) =>
              setF((p) => ({ ...p, customerTypes: [...p.customerTypes, label] })),
            )
          }
          placeholder="New customer type"
          pending={pending}
        />

        <PillRow
          label="Industry Type"
          options={opts("industry_type")}
          selected={f.industryTypes}
          onToggle={(v) => toggle("industryTypes", v)}
          onAdd={(v) =>
            addLookup("industry_type", v, (label) =>
              setF((p) => ({ ...p, industryTypes: [...p.industryTypes, label] })),
            )
          }
          placeholder="New industry type"
          pending={pending}
        />

        <div className="mt-5">
          <h3 className="font-bold text-ink-strong mb-2" style={{ fontSize: 13 }}>
            Product Types
          </h3>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            {products.map((p) => (
              <CheckPill
                key={p.id}
                label={p.name}
                checked={f.productIds.includes(p.id)}
                onToggle={() => toggle("productIds", p.id)}
                full
              />
            ))}
            <AddPillButton onAdd={addProduct} placeholder="New product" pending={pending} full />
          </div>
          {products.length === 0 && (
            <p className="mt-2 text-ink-subtle" style={{ fontSize: 12.5 }}>
              No active products yet — add them here or in Product Master.
            </p>
          )}
        </div>
      </SectionCard>

      {/* ── 2. Registration & Tax ───────────────────────────────────────── */}
      <SectionCard
        title="Registration & Tax"
        subtitle="GST, PAN, TIN and MSME / Udyam registration, plus tax handling."
      >
        <div className="grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
          <KycField
            label="PAN / IT No"
            hint={!f.panNo && derivedPan ? "From the GSTIN" : undefined}
          >
            <TextControl
              value={effectivePan}
              onChange={(e) => set("panNo", e.target.value.toUpperCase())}
              placeholder="ABCDE1234F"
              maxLength={20}
            />
          </KycField>
          <KycField label="MSME / Udyam No">
            <TextControl
              value={f.msmeUdyamNo}
              onChange={(e) => set("msmeUdyamNo", e.target.value.toUpperCase())}
              placeholder="UDYAM-MH-00-0000000"
              maxLength={40}
            />
          </KycField>
          <KycField
            label="GST Registration Type"
            onAdd={(v) =>
              addLookup("gst_registration_type", v, (l) => set("gstRegistrationType", l))
            }
          >
            <SelectControl
              value={f.gstRegistrationType}
              onChange={(e) => set("gstRegistrationType", e.target.value)}
              options={opts("gst_registration_type")}
              placeholder="Select a type"
            />
          </KycField>
          <KycField label="State">
            <SelectControl
              value={effectiveState}
              onChange={(e) => set("state", e.target.value)}
              options={dd("state")}
              placeholder="Select a state"
            />
          </KycField>

          {/* Second line. TIN and Website have had columns since 0087 and
              were simply never rendered here; only Test Certificate Needed is
              new (0095). IEC Code, Currency and Country used to sit in this
              section too — they moved to Export Details at the foot of the
              form, since they only matter for an exporting client. */}
          <KycField label="TIN No">
            <TextControl
              value={f.tinNumber}
              onChange={(e) => set("tinNumber", e.target.value.toUpperCase())}
              placeholder="TIN number"
              maxLength={40}
            />
          </KycField>
          <KycField label="Test Certificate Needed">
            <SelectControl
              value={f.testCertificateNeeded}
              onChange={(e) => set("testCertificateNeeded", e.target.value)}
              options={YES_NO}
            />
          </KycField>
          <KycField label="Website">
            <TextControl
              value={f.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="www.client.com"
              maxLength={200}
            />
          </KycField>
          <KycField label="TCS Applicable">
            <SelectControl
              value={f.tcsApplicable}
              onChange={(e) => set("tcsApplicable", e.target.value)}
              options={YES_NO}
            />
          </KycField>
        </div>
      </SectionCard>

      {/* ── 3. Contact Person ───────────────────────────────── */}
      <SectionCard
        title="Contact Person"
        subtitle="Purchase, Accounts and Other contacts - add as many of each as the client has. The first Purchase contact is the primary, auto-fetched on enquiries."
      >
        {CLIENT_CONTACT_TYPES.map((type, groupIdx) => {
          // Carry each row's index in the flat `f.contacts` array through the
          // filter: every edit and removal below has to address the real row,
          // not its position inside this one group.
          const group = f.contacts
            .map((c, i) => ({ c, i }))
            .filter((x) => x.c.contactType === type);
          const label = CLIENT_CONTACT_TYPE_LABELS[type];
          return (
            <div
              key={type}
              className={groupIdx > 0 ? "mt-8 pt-7" : ""}
              style={groupIdx > 0 ? { borderTop: "1px solid var(--color-hairline)" } : undefined}
            >
              {group.map(({ c, i }, n) => (
                <div key={i} className={n > 0 ? "mt-6" : ""}>
                  <BlockHeader
                    n={n + 1}
                    label={label}
                    action={
                      // Each group always keeps one block, so the group never
                      // disappears from the form - only the extras come off.
                      group.length > 1 ? (
                        <RemoveButton
                          onClick={() =>
                            set("contacts", f.contacts.filter((_, idx) => idx !== i))
                          }
                        />
                      ) : undefined
                    }
                  />
                <div className="grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
                  <KycField label="First Name" required={groupIdx === 0 && n === 0}>
                    <TextControl
                      value={c.firstName}
                      onChange={(e) => setRow<ContactRow>("contacts", i, { firstName: e.target.value })}
                      maxLength={80}
                    />
                  </KycField>
                  <KycField label="Last Name">
                    <TextControl
                      value={c.lastName}
                      onChange={(e) => setRow<ContactRow>("contacts", i, { lastName: e.target.value })}
                      maxLength={80}
                    />
                  </KycField>
                  {/* Phone or Email satisfies the rule; the marker sits on
                      Contact No as the one people fill first. */}
                  <KycField label="Contact No" required={groupIdx === 0 && n === 0}>
                    <TextControl
                      value={c.contactNo}
                      onChange={(e) => setRow<ContactRow>("contacts", i, { contactNo: e.target.value })}
                      inputMode="tel"
                      maxLength={40}
                    />
                  </KycField>
                  <KycField
                    label="Email"
                    error={c.email.trim() && !EMAIL_RE.test(c.email.trim()) ? "Not a valid email." : null}
                  >
                    <TextControl
                      value={c.email}
                      onChange={(e) => setRow<ContactRow>("contacts", i, { email: e.target.value })}
                      type="email"
                      maxLength={200}
                      invalid={Boolean(c.email.trim() && !EMAIL_RE.test(c.email.trim()))}
                    />
                  </KycField>
                  <KycField label="Designation" onAdd={(v) => addRoster("designations", v, i)}>
                    <RosterSelect
                      value={c.designationId}
                      onChange={(v) => setRow<ContactRow>("contacts", i, { designationId: v })}
                      options={allDesignations}
                      placeholder="Select a designation"
                    />
                  </KycField>
                  <KycField label="Department" onAdd={(v) => addRoster("departments", v, i)}>
                    <RosterSelect
                      value={c.departmentId}
                      onChange={(v) => setRow<ContactRow>("contacts", i, { departmentId: v })}
                      options={allDepartments}
                      placeholder="Select a department"
                    />
                  </KycField>
                </div>
                <div className="mt-5">
                  <KycField label="Contact Notes">
                    <TextAreaControl
                      value={c.notes}
                      onChange={(v) => setRow<ContactRow>("contacts", i, { notes: v })}
                      placeholder="Notes about this contact"
                      rows={2}
                    />
                  </KycField>
                </div>
                </div>
              ))}
              <div className="mt-4">
                <AddBlockButton
                  label={`Add ${label}`}
                  onClick={() => set("contacts", [...f.contacts, emptyContact(type)])}
                />
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── 4. Addresses ──────────────────────────────────── */}
      <SectionCard
        title="Addresses"
        subtitle="Billing, delivery and invoice-mailing addresses - add as many of each as the client has, and copy from billing when they match."
      >
        {CLIENT_ADDRESS_TYPES.map((type, groupIdx) => {
          // Same shape as the Contact Person groups above: filter the flat
          // array but carry each row's real index, so edits and removals
          // still address the right row.
          const group = f.addresses
            .map((a, i) => ({ a, i }))
            .filter((x) => x.a.addressType === type);
          const label = CLIENT_ADDRESS_TYPE_LABELS[type];
          return (
            <div
              key={type}
              className={groupIdx > 0 ? "mt-8 pt-7" : ""}
              style={groupIdx > 0 ? { borderTop: "1px solid var(--color-hairline)" } : undefined}
            >
              {group.map(({ a, i }, n) => (
                <div key={i} className={n > 0 ? "mt-6" : ""}>
                  <BlockHeader
                    n={n + 1}
                    label={label}
                    action={
                      <span className="flex items-center gap-2">
                        {type !== "billing" && (
                          <button
                            type="button"
                            onClick={() => {
                              const billing = f.addresses.find((x) => x.addressType === "billing");
                              if (!billing) return toast.error("No billing address to copy from.");
                              setRow<AddressRow>("addresses", i, {
                                line1: billing.line1,
                                line2: billing.line2,
                                line3: billing.line3,
                                line4: billing.line4,
                                city: billing.city,
                                state: billing.state,
                                country: billing.country,
                                pinCode: billing.pinCode,
                              });
                              toast.success("Billing address copied.");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 h-7 font-semibold"
                            style={{
                              fontSize: 12,
                              color: KYC_ACCENT,
                              border:
                                "1px solid color-mix(in srgb, var(--color-indigo) 28%, transparent)",
                            }}
                          >
                            <CornerDownRight size={12} strokeWidth={2.6} />
                            Copy from Billing Address
                          </button>
                        )}
                        {group.length > 1 && (
                          <RemoveButton
                            onClick={() =>
                              set("addresses", f.addresses.filter((_, idx) => idx !== i))
                            }
                          />
                        )}
                      </span>
                    }
                  />
                <div className="grid gap-x-3 gap-y-5 grid-cols-1 lg:grid-cols-2">
                  <KycField label="Address Line 1" required={type === "billing" && n === 0}>
                    <TextControl
                      value={a.line1}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { line1: e.target.value })}
                      placeholder="Building, Plot No."
                      maxLength={200}
                    />
                  </KycField>
                  <KycField label="Address Line 2">
                    <TextControl
                      value={a.line2}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { line2: e.target.value })}
                      placeholder="Street Name, Sector Name"
                      maxLength={200}
                    />
                  </KycField>
                  <KycField label="Address Line 3">
                    <TextControl
                      value={a.line3}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { line3: e.target.value })}
                      placeholder="Area"
                      maxLength={200}
                    />
                  </KycField>
                  <KycField label="Address Line 4">
                    <TextControl
                      value={a.line4}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { line4: e.target.value })}
                      placeholder="Nearby Landmark"
                      maxLength={200}
                    />
                  </KycField>
                </div>
                <div className="mt-5 grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                  <KycField label="City" required={type === "billing" && n === 0}>
                    <SuggestControl
                      value={a.city}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { city: e.target.value })}
                      suggestions={cityOptions}
                      listId={`kyc-cities-${i}`}
                      placeholder="e.g. Mumbai"
                      maxLength={120}
                    />
                  </KycField>
                  <KycField label="State">
                    <SelectControl
                      value={a.state}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { state: e.target.value })}
                      options={dd("state")}
                      placeholder="Select a state"
                    />
                  </KycField>
                  <KycField label="Country">
                    <SelectControl
                      value={a.country}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { country: e.target.value })}
                      options={dd("country")}
                      placeholder="Select a country"
                    />
                  </KycField>
                  <KycField
                    label="Pin Code"
                    required={type === "billing" && n === 0}
                    error={a.pinCode.trim() && !/^\d{6}$/.test(a.pinCode.trim()) ? "6 digits." : null}
                  >
                    <TextControl
                      value={a.pinCode}
                      onChange={(e) => setRow<AddressRow>("addresses", i, { pinCode: e.target.value })}
                      inputMode="numeric"
                      placeholder="400069"
                      maxLength={20}
                      invalid={Boolean(a.pinCode.trim() && !/^\d{6}$/.test(a.pinCode.trim()))}
                    />
                  </KycField>
                </div>
                  {/* Invoice Mailing only - this is the address an invoice is
                      actually emailed to, which the other two blocks have no
                      use for. The column exists on every row regardless. */}
                  {type === "invoice_mailing" && (
                    <div className="mt-5 grid gap-x-3 gap-y-5 grid-cols-1 lg:grid-cols-2">
                      <KycField
                        label="Email Address"
                        error={
                          a.email.trim() && !EMAIL_RE.test(a.email.trim())
                            ? "Not a valid email."
                            : null
                        }
                      >
                        <TextControl
                          value={a.email}
                          onChange={(e) =>
                            setRow<AddressRow>("addresses", i, { email: e.target.value })
                          }
                          type="email"
                          placeholder="accounts@client.com"
                          maxLength={200}
                          invalid={Boolean(a.email.trim() && !EMAIL_RE.test(a.email.trim()))}
                        />
                      </KycField>
                    </div>
                  )}
                </div>
              ))}
              <div className="mt-4">
                <AddBlockButton
                  label={`Add ${label}`}
                  onClick={() => set("addresses", [...f.addresses, emptyAddress(type)])}
                />
              </div>
            </div>
          );
        })}
      </SectionCard>

      {/* ── 5. Commercial & Credit ──────────────────────────────────────── */}
      <SectionCard
        title="Commercial & Credit"
        subtitle="Payment terms, credit limits, freight and logistics details."
      >
        <div className="grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
          <KycField
            label="Payment Terms"
            onAdd={(v) => addLookup("kyc_payment_terms", v, (l) => set("paymentTerms", l))}
          >
            <SelectControl
              value={f.paymentTerms}
              onChange={(e) => set("paymentTerms", e.target.value)}
              options={dd("kyc_payment_terms")}
              placeholder="Select terms"
            />
          </KycField>
          <KycField
            label="Freight Charges"
            onAdd={(v) => addLookup("freight_charges", v, (l) => set("freightCharges", l))}
          >
            <SelectControl
              value={f.freightCharges}
              onChange={(e) => set("freightCharges", e.target.value)}
              options={dd("freight_charges")}
              placeholder="Select freight"
            />
          </KycField>
          <KycField
            label="Credit Days"
            onAdd={(v) => addLookup("credit_days", v, (l) => set("creditDays", l))}
          >
            <select
              value={f.creditDays}
              onChange={(e) => set("creditDays", e.target.value)}
              className="w-full rounded-lg h-11 px-3 bg-surface-card border outline-none text-[14px] text-ink-strong appearance-none pr-8"
              style={{
                borderColor: "var(--color-hairline-strong)",
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                backgroundPosition: "right 10px center",
                backgroundRepeat: "no-repeat",
              }}
            >
              <option value="">Select credit days</option>
              {dd("credit_days").map((d) => (
                <option key={d} value={d}>
                  {/^\d+$/.test(d) ? `${d} days` : d}
                </option>
              ))}
            </select>
          </KycField>
          <KycField
            label="Credit Limit"
            onAdd={(v) => addLookup("credit_limit", v, (l) => set("creditLimit", l))}
          >
            <SelectControl
              value={f.creditLimit}
              onChange={(e) => set("creditLimit", e.target.value)}
              options={dd("credit_limit")}
              placeholder="Select a credit limit"
            />
          </KycField>
          <KycField
            label="Transporter"
            onAdd={(v) => addLookup("transporter", v, (l) => set("transporter", l))}
          >
            <SelectControl
              value={f.transporter}
              onChange={(e) => set("transporter", e.target.value)}
              options={dd("transporter")}
              placeholder="Select a transporter"
            />
          </KycField>
          <KycField
            label="Quantity Deviation"
            onAdd={(v) => addLookup("quantity_deviation", v, (l) => set("quantityDeviation", l))}
          >
            <SelectControl
              value={f.quantityDeviation}
              onChange={(e) => set("quantityDeviation", e.target.value)}
              options={dd("quantity_deviation")}
              placeholder="Select a tolerance"
            />
          </KycField>
        </div>

        <div className="mt-5 grid gap-x-3 gap-y-5 grid-cols-1 lg:grid-cols-2">
          <KycField label="Other References">
            <TextAreaControl
              value={f.otherReferences}
              onChange={(v) => set("otherReferences", v)}
              placeholder="Any other references or notes relevant to this client"
            />
          </KycField>
          <KycField label="Client Notes">
            <TextAreaControl
              value={f.notes}
              onChange={(v) => set("notes", v)}
              placeholder="Notes about this client"
            />
          </KycField>
        </div>
      </SectionCard>

      {/* ── 6. Bank Details ─────────────────────────────────────────────── */}
      <SectionCard
        title="Bank Details"
        subtitle="One or more bank accounts for payments - flag one as primary."
      >
        {f.bankAccounts.map((b, i) => (
          <div key={i} className={i > 0 ? "mt-6" : ""}>
            <BlockHeader
              n={i + 1}
              label="Account"
              action={
                f.bankAccounts.length > 1 ? (
                  <RemoveButton
                    onClick={() => {
                      const next = f.bankAccounts.filter((_, idx) => idx !== i);
                      // Removing the primary promotes the first survivor, so a
                      // client is never left with accounts but no primary.
                      if (b.isPrimary && next[0]) next[0] = { ...next[0], isPrimary: true };
                      set("bankAccounts", next);
                    }}
                  />
                ) : undefined
              }
            />
            <div className="grid gap-x-3 gap-y-5 grid-cols-1 lg:grid-cols-3">
              <div>
                <KycField label="Account Name">
                  <TextControl
                    value={b.accountName}
                    onChange={(e) => setRow<BankRow>("bankAccounts", i, { accountName: e.target.value })}
                    placeholder="Name on the account"
                    maxLength={160}
                  />
                </KycField>
                <button
                  type="button"
                  onClick={() => {
                    if (!f.name.trim()) return toast.error("Enter the company name first.");
                    setRow<BankRow>("bankAccounts", i, { accountName: f.name });
                  }}
                  className="mt-1 inline-flex items-center gap-1 font-semibold"
                  style={{ fontSize: 11.5, color: KYC_ACCENT }}
                >
                  <CornerDownRight size={11} strokeWidth={2.8} />
                  Same as company
                </button>
              </div>
              <KycField label="Bank Name" onAdd={(v) => addLookup("bank_name", v, (l) => setRow<BankRow>("bankAccounts", i, { bankName: l }))}>
                <SelectControl
                  value={b.bankName}
                  onChange={(e) => setRow<BankRow>("bankAccounts", i, { bankName: e.target.value })}
                  options={dd("bank_name")}
                  placeholder="Select a bank"
                />
              </KycField>
              <KycField label="Account No">
                <TextControl
                  value={b.accountNo}
                  onChange={(e) => setRow<BankRow>("bankAccounts", i, { accountNo: e.target.value })}
                  maxLength={60}
                />
              </KycField>
            </div>
            <div className="mt-5 grid gap-x-3 gap-y-5 grid-cols-1 lg:grid-cols-3">
              <KycField label="IFSC / SWIFT Code">
                <TextControl
                  value={b.ifscSwift}
                  onChange={(e) =>
                    setRow<BankRow>("bankAccounts", i, { ifscSwift: e.target.value.toUpperCase() })
                  }
                  placeholder="IFSC (domestic) or SWIFT (international)"
                  maxLength={30}
                />
              </KycField>
              <KycField label="Branch">
                <TextControl
                  value={b.branch}
                  onChange={(e) => setRow<BankRow>("bankAccounts", i, { branch: e.target.value })}
                  placeholder="e.g. Ambad, Nashik"
                  maxLength={160}
                />
              </KycField>
              <KycField
                label="Account Type"
                onAdd={(v) =>
                  addLookup("bank_account_type", v, (l) =>
                    setRow<BankRow>("bankAccounts", i, { accountType: l }),
                  )
                }
              >
                <SelectControl
                  value={b.accountType}
                  onChange={(e) => setRow<BankRow>("bankAccounts", i, { accountType: e.target.value })}
                  options={dd("bank_account_type")}
                  placeholder="Select account type"
                />
              </KycField>
            </div>
            <label className="mt-4 inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={b.isPrimary}
                onChange={(e) =>
                  // Exactly one primary: ticking this unticks every other row,
                  // which is the same rule saveClientKyc enforces server-side.
                  set(
                    "bankAccounts",
                    f.bankAccounts.map((row, idx) => ({ ...row, isPrimary: e.target.checked && idx === i })),
                  )
                }
                className="size-4"
                style={{ accentColor: KYC_ACCENT }}
              />
              <span className="font-semibold text-ink-soft" style={{ fontSize: 13 }}>
                Primary Account
              </span>
            </label>
          </div>
        ))}
        <div className="mt-4">
          <AddBlockButton
            label="Add Account"
            onClick={() =>
              set("bankAccounts", [...f.bankAccounts, emptyBank(f.bankAccounts.length === 0)])
            }
          />
        </div>
      </SectionCard>

      {/* ── 7. Documents ────────────────────────────────────────────────── */}
      <SectionCard
        title="Documents"
        optional
        subtitle="Attach any document, image, audio, or video to this client record - plus scans of the contact's business card. Nothing here is needed to onboard the client."
      >
        {!attachId && (
          <p className="mb-4 text-ink-subtle" style={{ fontSize: 13 }}>
            Fill in the Company Name and these will open — the file attaches to
            this client&apos;s draft straight away. You can also leave this
            section empty and add documents later.
          </p>
        )}
        <BlockHeader n={1} label="Business Card & Documents" />
        <div className="flex flex-wrap gap-4">
          <UploadTile label="Front" cta="Add front" customerMasterId={attachId} ensureId={ensureAttachTarget} title="Business card — front" />
          <UploadTile label="Back" cta="Add back" customerMasterId={attachId} ensureId={ensureAttachTarget} title="Business card — back" />
          <UploadTile label="Other" cta="Add files" customerMasterId={attachId} ensureId={ensureAttachTarget} title="Client document" multiple />
        </div>
      </SectionCard>

      {/* ── 8. Export Details ───────────────────────────────────────────── */}
      <SectionCard
        title="Export Details"
        subtitle="Only for clients you export to - the IEC code, the currency you invoice them in, and where the goods go."
      >
        <div className="grid gap-x-3 gap-y-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <KycField label="Export">
            <SelectControl
              value={f.exportClient}
              onChange={(e) => set("exportClient", e.target.value)}
              options={YES_NO}
            />
          </KycField>
          <KycField label="IEC Code">
            <TextControl
              value={f.iecNumber}
              onChange={(e) => set("iecNumber", e.target.value.toUpperCase())}
              placeholder="0123456789"
              maxLength={40}
            />
          </KycField>
          <KycField label="Currency" onAdd={(v) => addLookup("currency", v, (l) => set("currency", l))}>
            <SelectControl
              value={f.currency}
              onChange={(e) => set("currency", e.target.value)}
              options={dd("currency")}
              placeholder="Select a currency"
            />
          </KycField>
          <KycField label="Country" onAdd={(v) => addLookup("country", v, (l) => set("country", l))}>
            <SelectControl
              value={f.country}
              onChange={(e) => set("country", e.target.value)}
              options={dd("country")}
              placeholder="Select a country"
            />
          </KycField>
        </div>
      </SectionCard>

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      <div
        className="kyc-actions sticky bottom-0 z-20 flex items-center justify-end gap-3 flex-wrap px-4 py-3 rounded-lg"
        style={{
          background: "var(--color-surface-card)",
          borderTop: "1px solid var(--color-hairline)",
        }}
      >
        {/* Says where the button will put this record, before it is pressed.
            The red-starred boxes mark the same requirements field by field;
            this is the running total of the ones still open. */}
        {/* Says what is still standing between this form and a client, so
            Onboard Client refusing is never a surprise. Save to Draft works
            throughout either way. */}
        {missingNow.length > 0 ? (
          <span
            className="mr-auto flex items-center gap-1.5 min-w-0"
            style={{ fontSize: 12, color: "var(--color-red-deep)" }}
          >
            <AlertCircle size={14} strokeWidth={2.4} className="shrink-0" />
            <span className="truncate">
              To onboard, still needs {missingNow.join(", ")}
            </span>
          </span>
        ) : (
          <span className="text-ink-subtle mr-auto" style={{ fontSize: 12 }}>
            Ready to onboard · Ctrl / ⌘ + Enter
          </span>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 h-10 font-bold text-ink-soft bg-surface-card"
          style={{ fontSize: 13.5, border: "1px solid var(--color-hairline-strong)" }}
        >
          <FileText size={15} strokeWidth={2.3} />
          View in PDF Format
        </button>
        {/* Both are always offered. Which one applies is the user's call, not
            something to infer from how full the form happens to be — an
            unfinished KYC is a legitimate draft, and a complete one may still
            not be ready to onboard. */}
        <button
          type="button"
          onClick={saveToDraft}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 h-10 font-bold text-ink-soft bg-surface-card disabled:opacity-60"
          style={{ fontSize: 13.5, border: "1px solid var(--color-hairline-strong)" }}
        >
          <Save size={15} strokeWidth={2.3} />
          {draftId ? "Update Draft" : "Save to Draft"}
        </button>
        <button
          type="button"
          onClick={onboard}
          disabled={pending}
          className="rounded-lg px-6 h-10 text-white font-bold disabled:opacity-60"
          style={{ fontSize: 14, background: KYC_ACCENT }}
        >
          {pending ? "Saving…" : "Onboard Client"}
        </button>
      </div>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/** A labelled wrap of multi-select pills closed by its own "+ Add". */
function PillRow({
  label,
  options,
  selected,
  onToggle,
  onAdd,
  placeholder,
  pending,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onAdd: (v: string) => void;
  placeholder: string;
  pending: boolean;
}) {
  return (
    <div className="mt-5">
      <h3 className="font-bold text-ink-strong mb-2" style={{ fontSize: 13 }}>
        {label}
      </h3>
      <div className="flex flex-wrap items-stretch gap-2">
        {options.map((o) => (
          <CheckPill key={o} label={o} checked={selected.includes(o)} onToggle={() => onToggle(o)} />
        ))}
        <AddPillButton onAdd={onAdd} placeholder={placeholder} pending={pending} />
      </div>
    </div>
  );
}

/** Designation / Department picker — {id,name} rows rather than plain strings. */
function RosterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: RosterOption[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg h-11 px-3 bg-surface-card border outline-none text-[14px] text-ink-strong appearance-none pr-8"
      style={{
        borderColor: "var(--color-hairline-strong)",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundPosition: "right 10px center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/**
 * One dashed upload square. Disabled until the client has an id — the server
 * action hangs the `documents` row off `customerMasterId`, so there is nothing
 * to attach to before the first save.
 */
function UploadTile({
  label,
  cta,
  customerMasterId,
  ensureId,
  title,
  multiple,
}: {
  label: string;
  cta: string;
  customerMasterId: string | null;
  /**
   * Produces a record to attach to when there isn't one yet, by flushing the
   * form's autosave. Returning null means it could not — the caller has
   * already explained why — so the picker simply doesn't open.
   */
  ensureId: () => Promise<string | null>;
  title: string;
  multiple?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string[]>([]);
  const ref = React.useRef<HTMLInputElement>(null);
  // Set when a click had to create the record on the spot. The prop catches
  // up on the parent's next render; this covers the gap in between.
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  // The tile stays clickable throughout — only an in-flight upload disables
  // it — because the record is resolved on click rather than required upfront.
  const target = customerMasterId ?? createdId;

  async function openPicker() {
    if (busy) return;
    if (!target) {
      const id = await ensureId();
      if (!id) return;
      setCreatedId(id);
    }
    // The native picker is a separate turn of the event loop, so by the time
    // a file comes back this component has re-rendered with the new id.
    ref.current?.click();
  }

  async function upload(files: FileList | null) {
    if (!files || !target) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("customerMasterId", target);
      fd.set("file", file);
      fd.set("title", multiple ? file.name : title);
      const res = await attachClientKycFile(fd);
      if (res.ok) {
        setDone((p) => [...p, file.name]);
        toast.success(`${file.name} attached.`);
      } else {
        toast.error(res.error);
      }
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div>
      <span className="block mb-1 text-ink-subtle" style={{ fontSize: 11 }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => void openPicker()}
        disabled={busy}
        title={customerMasterId ? undefined : "Adds to this client's draft."}
        className="grid place-items-center gap-1.5 rounded-lg disabled:opacity-45 disabled:cursor-not-allowed transition-colors hover:border-[color:var(--color-indigo)]"
        style={{
          width: 100,
          height: 96,
          border: "1px dashed var(--color-hairline-strong)",
          background: "var(--color-surface-soft)",
        }}
      >
        {multiple ? (
          <Plus size={18} strokeWidth={2.4} className="text-ink-subtle" />
        ) : (
          <ImagePlus size={18} strokeWidth={2.2} className="text-ink-subtle" />
        )}
        <span className="text-ink-soft font-semibold" style={{ fontSize: 11.5 }}>
          {busy ? "Uploading…" : cta}
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        multiple={multiple}
        onChange={(e) => void upload(e.target.files)}
      />
      {done.length > 0 && (
        <span className="block mt-1 text-ink-subtle" style={{ fontSize: 11 }}>
          {done.length} attached
        </span>
      )}
    </div>
  );
}
