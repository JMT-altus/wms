import type { SoDependency, SoField, SoFieldType, SoGroupKey, SoLevel, SoSection, SoXStatus } from "./sales-order-catalogue";

/**
 * The PROVISIONS: the 238 fields the "Accounting Voucher (Read Me)" worksheet marks x for Sales Orders that the WMS
 * does not offer by default. Each is a full catalogue entry — its exact Tally name, worksheet row, section, where an
 * order would hold it, its type and Tally's listed values — so Admin & Master Setup → Sales Order Fields can configure
 * every one of them. All are OFF until an administrator enables one (`defaultOff`); an enabled one is stored by its
 * key with the order (`keyed`), exactly like the x fields the WMS already offers and like custom fields, so it reaches
 * the form, the import, the preview, the comparison and the order page with no list of its own anywhere.
 *
 * Being in the catalogue does not make a field work the way it does in Tally. Each group says what stands in the way:
 *   (none)      a plain value of the order: enabled, it is a complete optional field;
 *   recordOnly  it can be enabled and is stored, imported and shown, but the WMS does none of what Tally does with it
 *               (no portal exchange, no tax worked out, no payment recorded, no master checked);
 *   needsWork   it can NOT be enabled until the named technical work is done (none is, today).
 * A group with `group` set is one of Tally's REPEATING GROUPS (./sales-order-catalogue → SO_GROUPS): its fields are
 * the columns of rows under a ledger entry or the order, read, checked, stored and shown as rows.
 *
 * `why` is why the matrix marks it x for a Sales Order (the audit's verdict): where the field really belongs.
 */

type Row = readonly [key: string, tallyName: string, matrixRow: number, type?: SoFieldType, options?: readonly string[]];
interface Group {
  section: SoSection;
  /** Where an order holds one of these once enabled: the order itself, a ledger entry, a product line or an allocation. */
  level: SoLevel;
  x: SoXStatus;
  why: string;
  dependency?: SoDependency;
  /** The repeating group whose rows these fields are the columns of. */
  group?: SoGroupKey;
  rows: readonly Row[];
}

const recordOnly = (text: string): SoDependency => ({ kind: "recordOnly", text: `Record only: the WMS stores, imports and shows the value as given. ${text}` });
/** A repeating group's fields: the rows are kept, checked and shown; Tally's accounting behind them isn't done. */
const rows = (text: string): SoDependency => recordOnly(`Entered as rows under its ${text}`);

const STATUTORY_WHY = "Statutory payment and adjustment vouchers, not orders.";
const TAX_DEDUCTION_WHY = "TDS and TCS are worked out on invoices, payments and receipts, not on orders.";
const NO_TAX = recordOnly("No TDS or TCS is worked out, deducted or collected from it.");
const NO_STATUTORY = recordOnly("No statutory adjustment or payment is posted from it.");
const BILL_ROWS = "ledger entry, one row per bill reference. No bill-wise receivable, interest or TDS/TCS is created from them.";
const DEDUCTEE = ["All Items", "Company", "Non Company"] as const;
const RESIDENT = ["All Items", "Resident", "NonResident"] as const;

const statPayment = (prefix: string, tally: string, first: number, nature: string): Row[] => [
  [`${prefix}TaxType`, `${tally} - Tax Type`, first],
  [`${prefix}PeriodFrom`, `${tally} - Period From`, first + 1, "date"],
  [`${prefix}PeriodTo`, `${tally} - Period To`, first + 2, "date"],
  [`${prefix}Section`, `${tally} - Section`, first + 3],
  [`${prefix}Nature`, `${tally} - ${nature}`, first + 4],
  [`${prefix}DeducteeStatus`, `${tally} - Deductee Status`, first + 5, "choice", DEDUCTEE],
  [`${prefix}ResidentialStatus`, `${tally} - Residential Status`, first + 6, "choice", RESIDENT],
  [`${prefix}ChequeNo`, `${tally} - Cheque No.`, first + 7],
  [`${prefix}ChequeDate`, `${tally} - Cheque Date`, first + 8, "date"],
  [`${prefix}BsrCode`, `${tally} - BSR Code`, first + 9],
  [`${prefix}ChallanNo`, `${tally} - Challan No.`, first + 10],
  [`${prefix}ChallanDate`, `${tally} - Challan Date`, first + 11, "date"],
  [`${prefix}BankName`, `${tally} - Bank Name`, first + 12],
  [`${prefix}BranchName`, `${tally} - Branch Name`, first + 13],
];

const billAllocations = (prefix: string, tally: string, first: number, nature: string, otherLedger: string): Row[] => [
  [`${prefix}TypeOfRef`, `${tally} - Type of Ref`, first],
  [`${prefix}Name`, `${tally} - Name`, first + 1],
  [`${prefix}Nature`, `${tally} - ${nature}`, first + 2],
  [`${prefix}PartyLedger`, `${tally} - Party Ledger`, first + 3],
  [`${prefix}${otherLedger.replace(/ /g, "")}`, `${tally} - ${otherLedger}`, first + 4],
  [`${prefix}DutyLedger`, `${tally} - Duty Ledger`, first + 5],
  [`${prefix}AssessableAmount`, `${tally} - Assessable Amount`, first + 6, "amount"],
  [`${prefix}PayableAmount`, `${tally} - Payable Amount`, first + 7, "amount"],
  [`${prefix}PaidAmount`, `${tally} - Paid Amount`, first + 8, "amount"],
];

const GROUPS: readonly Group[] = [
  { section: "General Details", level: "voucher", x: "notApplicable", why: "Receipt vouchers only.", rows: [["nameOnReceipt", "Name on Receipt", 15]] },
  { section: "Ledger Details", level: "ledger", x: "notApplicable", why: "Statutory payment vouchers only.", rows: [["typeOfTaxPayment", "Type of Tax Payment", 24]] },
  {
    section: "Item Details", level: "item", x: "approval",
    why: "Tally's cash/trade discount changes how a line's amount and the order total are worked out: it needs an approved pricing rule first.",
    rows: [
      ["cashTradeDiscRate", "Discount Rate (Cash/Trade)", 37, "percent"],
      ["cashTradeDiscAmount", "Discount Amount (Cash/Trade)", 38, "amount"],
    ],
  },
  {
    section: "Dispatch/Receipt/Party's Document Details", level: "voucher", x: "notApplicable", why: "Recorded when goods are dispatched (Delivery Note or Sales invoice), after the order.",
    rows: [
      ["deliveryNoteNo", "Delivery Note No./Receipt Note No./Challan No./Tracking No.", 48],
      ["deliveryNoteDate", "Delivery Note Date/Receipt Note Date/Challan Date/Tracking Date", 49, "date"],
      ["dispatchDocNo", "Dispatch Doc No. /Receipt Doc No./Challan Doc No.", 50],
      ["billOfLadingNo", "Bill of lading/LR RR No.", 54],
      ["billOfLadingDate", "Bill of lading/LR RR No. - Date", 55, "date"],
      ["motorVehicleNo", "Motor Vehicle No.", 56],
    ],
  },
  {
    section: "Export/Import Details", level: "voucher", x: "external", why: "Customs documents issued at shipment (ICEGATE), after the order: they belong to the export invoice.",
    rows: [
      ["shippingBillNo", "Shipping Bill No.", 63],
      ["shippingBillDate", "Shipping Bill Date", 64, "date"],
      ["portCode", "Port Code", 65],
      ["billOfEntryNo", "Bill of Entry No.", 66],
      ["billOfEntryDate", "Bill of Entry Date", 67, "date"],
    ],
  },
  {
    section: "Additional Details", level: "voucher", x: "notApplicable", why: "Debit and credit notes only.",
    rows: [
      ["buyerDebitNoteNo", "Buyer's Debit Note No.", 69],
      ["buyerDebitNoteDate", "Buyer's Debit Note - Date", 70, "date"],
      ["supplierNoteNo", "Supplier's Debit/Credit Note No.", 71],
      ["supplierNoteDate", "Supplier's Debit/Credit Note - Date", 72, "date"],
      ["noteReason", "Reason for Issuing Note", 73],
    ],
  },
  {
    section: "Item Allocations Details", level: "allocation", x: "notApplicable", why: "Chosen from stock when goods are dispatched (Delivery Note), not on the order.",
    rows: [
      ["allocBatchNo", "Item Allocations - Batch/Lot No.", 77],
      ["allocMfgDate", "Item Allocations - Mfg. Date", 84, "date"],
      ["allocExpiryDate", "Item Allocations - Expiry Date", 85, "date"],
    ],
  },
  {
    section: "Item Allocations Details", level: "allocation", x: "approval", why: "Needs a godown/location master shared with Tally and an inventory workflow the WMS doesn't have: a business decision first.",
    dependency: recordOnly("It is free text: not checked against a godown or location master, and no stock is tracked by it."),
    rows: [
      ["allocGodown", "Item Allocations - Godown Name", 93],
      ["allocLocation", "Item Allocations - Location Name", 94],
    ],
  },
  {
    section: "Bill Allocations", level: "ledger", x: "notApplicable", why: "Bill-wise receivables and interest are created by the sales invoice, not the order.",
    group: "billAllocations", dependency: rows(BILL_ROWS),
    rows: [
      ["billTypeOfRef", "Bill Type of Ref", 96, "choice", ["Advance", "Agst Ref", "New Ref", "On Account"]],
      ["billName", "Bill Name", 97],
      ["billAmount", "Bill Amount", 98, "amount"],
      ["billAmountDrCr", "Bill Amount - Dr/Cr", 99, "choice", ["Dr", "Cr"]],
      ["billDueOrCreditDays", "Bill Due Dt or Credit Days", 100],
      ["billInterestOn", "Interest - on", 101],
      ["billInterestFrom", "Interest - From Date", 102, "date"],
      ["billInterestTo", "Interest - To Date", 103, "date"],
      ["billInterestPer", "Interest - % per", 104],
      ["billInterestRate", "Interest - Rate", 105, "percent"],
      ["billInterestApplicability", "Interest - Applicability", 106],
      ["billInterestBy", "Interest - By", 107],
      ["billInterestRounding", "Interest - Rounding", 108],
      ["billInterestLimit", "Interest - Limit", 109],
    ],
  },
  {
    section: "Original Invoice Details", level: "voucher", x: "notApplicable", why: "Credit notes and sales returns refer to an original invoice; an order has none.",
    rows: [
      ["originalInvoiceNo", "Original Invoice No.", 116],
      ["originalInvoiceDate", "Original Invoice - Date", 117, "date"],
    ],
  },
  {
    section: "e-Invoice Details", level: "voucher", x: "external", why: "Generated by the GST e-Invoice portal (IRP) for invoices, never for orders.",
    dependency: recordOnly("Nothing is sent to or fetched from the GST e-Invoice portal (IRP)."),
    rows: [
      ["einvAckNo", "e-Invoice - Ack No.", 120],
      ["einvAckDate", "e-Invoice - Ack Date", 121, "date"],
      ["einvIrn", "e-Invoice - IRN", 122],
      ["einvBillToPlace", "e-Invoice - Bill to place", 123],
      ["einvShipToPlace", "e-Invoice - Ship to place", 124],
      ["einvDispatchFromName", "e-Invoice - Dispatch From Name", 125],
      ["einvDispatchFromAddress", "e-Invoice - Dispatch From Address", 126],
      ["einvDispatchFromState", "e-Invoice - Dispatch From State", 127],
      ["einvDispatchFromPincode", "e-Invoice - Dispatch From Pincode", 128],
      ["einvDispatchFromPlace", "e-Invoice - Dispatch From Place", 129],
      ["einvCancelReason", "e-Invoice Cancellation - Reason for Cancellation", 130],
      ["einvCancelRemarks", "e-Invoice Cancellation - Remarks", 131],
    ],
  },
  {
    section: "e-Way Bill Details", level: "voucher", x: "external", why: "Generated on the e-Way Bill portal when goods move, never for orders.",
    dependency: recordOnly("No e-Way Bill is generated, extended or cancelled on the portal."),
    rows: [
      ["ewayBillNo", "e-Way Bill No.", 133],
      ["ewayBillDate", "e-Way Bill Date", 134, "date"],
      ["ewayConsolidatedNo", "Consolidated e-Way Bill No.", 135],
      ["ewayConsolidatedDate", "Consolidated e-Way Bill Date", 136, "date"],
      ["ewaySubType", "e-Way Bill - Sub-Type", 137, "choice", ["Not Applicable", "Exhibition or Fairs", "Export", "For Own Use", "Job Work", "Lines Sales", "Others", "Recipient Not Known", "SKD/CKD/Lots", "Supply", "Job Work Returns", "Sales Return", "Import"]],
      ["ewayDocumentType", "e-Way Bill - Document Type", 138, "choice", ["Not Applicable", "Bill of Entry", "Bill of Supply", "Delivery Challan", "Others", "Tax Invoice"]],
      ["ewayFromAddress1", "Consignor Details (From) - Address-1", 139],
      ["ewayFromAddress2", "Consignor Details (From) - Address-2", 140],
      ["ewayFromAddressType", "Consignor Details (From) - Address Type", 141],
      ["ewayFromPincode", "Consignor Details (From) - Pincode", 142],
      ["ewayFromPlace", "Consignor Details (From) - Place", 143],
      ["ewayFromState", "Consignor Details (From) - Actual State", 144],
      ["ewayToAddress1", "Consignee Details (To) - Address-1", 145],
      ["ewayToAddress2", "Consignee Details (To) - Address-2", 146],
      ["ewayToAddressType", "Consignee Details (To) - Address Type", 147],
      ["ewayToPlace", "Consignee Details (To) - Place", 148],
      ["ewayToState", "Consignee Details (To) - Actual State", 149],
      ["ewayToPincode", "Consignee Details (To) - Pincode", 150],
      ["ewayTransportDistance", "e-Way Bill Transport Details - Pin to Pin Distance as per Portal", 151, "number"],
      ["ewayTransporterName", "e-Way Bill Transport Details - Transporter Name", 152],
      ["ewayTransporterId", "e-Way Bill Transport Details - Transporter ID", 153],
      ["ewayTransportMode", "e-Way Bill Transport Details - Mode", 154],
      ["ewayTransportDocNo", "e-Way Bill Transport Details - Doc/Lading/RR/Airway No.", 155],
      ["ewayTransportDocDate", "e-Way Bill Transport Details - Doc/Lading/RR/Airway Date", 156, "date"],
      ["ewayTransportVehicleNo", "e-Way Bill Transport Details - Vehicle Number", 157],
      ["ewayTransportVehicleType", "e-Way Bill Transport Details - Vehicle Type", 158],
      ["ewayTransportPlace", "e-Way Bill Transport Details - Place", 159],
      ["ewayTransportState", "e-Way Bill Transport Details - State", 160],
      ["ewayTransportReason", "e-Way Bill Transport Details - Reason", 161],
      ["ewayTransportRemarks", "e-Way Bill Transport Details - Remarks", 162],
      ["ewayExtDistance", "e-Way Bill Extension Details - Remaining Distance(in KM)", 163, "number"],
      ["ewayExtMode", "e-Way Bill Extension Details - Mode", 164, "choice", ["Not Applicable", "1- Road", "2 - Rail", "3 - Air", "4 - Ship"]],
      ["ewayExtDocNo", "e-Way Bill Extension Details - Doc/Lading/RR/Airway No.", 165],
      ["ewayExtDocDate", "e-Way Bill Extension Details - Doc/Lading/RR/Airway - Date", 166, "date"],
      ["ewayExtVehicleNo", "e-Way Bill Extension Details - Vehicle Number", 167],
      ["ewayExtVehicleType", "e-Way Bill Extension Details - Vehicle Type", 168],
      ["ewayExtTransitType", "e-Way Bill Extension Details - Transit Type", 169],
      ["ewayExtAddress1", "e-Way Bill Extension Details - Address 1", 170],
      ["ewayExtAddress2", "e-Way Bill Extension Details - Address 2", 171],
      ["ewayExtAddress3", "e-Way Bill Extension Details - Address 3", 172],
      ["ewayExtPincode", "e-Way Bill Extension Details - Current Pincode", 173],
      ["ewayExtPlace", "e-Way Bill Extension Details - Current Place", 174],
      ["ewayExtState", "e-Way Bill Extension Details - Current State", 175],
      ["ewayExtReason", "e-Way Bill Extension Details - Reason", 176],
      ["ewayExtRemarks", "e-Way Bill Extension Details - Remarks", 177],
      ["ewayCancelReason", "e-Way Bill Cancellation Details - Reason", 178, "choice", ["Not Applicable", "1 - Duplicate", "2 - Order Cancelled", "3 - Data Entry Mistake", "4 - Others"]],
      ["ewayCancelRemarks", "e-Way Bill Cancellation Details - Remarks", 179],
    ],
  },
  {
    section: "Stat Adjustment (GST)", level: "voucher", x: "notApplicable", why: "Journal vouchers for GST adjustments.", dependency: NO_STATUTORY,
    rows: [
      ["statAdjGstDutyType", "Stat Adjustment (GST) - Type of Duty/Tax", 228],
      ["statAdjGstNature", "Stat Adjustment (GST) - Nature of Adjustment", 229],
      ["statAdjGstAdditionalNature", "Stat Adjustment (GST) - Additional Nature of Adjustment", 230],
      ["statAdjGstRate", "Stat Adjustment (GST) - Rate", 231, "percent"],
      ["statAdjGstTaxableValue", "Stat Adjustment (GST) - Taxable Value", 232, "amount"],
      ["statAdjGstIsdNoteNo", "Stat Adjustment (GST) - ISD Invoice/Debit/Credit Note No.", 233],
      ["statAdjGstIsdNoteDate", "Stat Adjustment (GST) - ISD Invoice/Debit/Credit Note Date", 234, "date"],
      ["statAdjGstItcEligible", "Stat Adjustment (GST) - Eligible for Input Tax Credit", 235, "yesno"],
      ["statAdjGstSupplyType", "Stat Adjustment (GST) - Type of Supply", 236],
    ],
  },
  {
    section: "Bank Allocations Details", level: "ledger", x: "notApplicable", why: "Payment and receipt vouchers (banking).",
    group: "bankAllocations", dependency: rows("ledger entry, one row per instrument. Nothing is recorded in the bank books and no payment is made."),
    rows: [
      ["bankRefId", "Bank Allocations - Ref ID", 249],
      ["bankTransactionType", "Bank Allocations - Transaction Type", 250, "choice", ["Cheque/DD", "e-Fund Transfer", "Others", "ATM", "Card", "ECS", "Electronic Cheque", "Electronic DD/PO", "Same Bank Transfer", "Inter Bank Transfer"]],
      ["bankAmount", "Bank Allocations - Amount", 251, "amount"],
      ["bankAccountNo", "Bank Allocations - A/c No.", 252],
      ["bankName", "Bank Allocations - Bank Name", 253],
      ["bankBranch", "Bank Allocations - Branch", 254],
      ["bankInstNo", "Bank Allocations - Inst No.", 255],
      ["bankInstDate", "Bank Allocations - Inst Date", 256, "date"],
      ["bankFavouringName", "Bank Allocations - Favouring Name", 257],
      ["bankBeneficiaryCode", "Bank Allocations - Beneficiary Code", 258],
      ["bankIfsCode", "Bank Allocations - IFS Code", 259],
      ["bankSwiftCode", "Bank Allocations - SWIFT Code", 260],
      ["bankEmailId", "Bank Allocations - Email ID", 261],
      ["bankCrossUsing", "Bank Allocations - Cross Using", 262],
      ["bankRemarks", "Bank Allocations - Remarks", 263],
      ["bankChequeRange", "Bank Allocations - Cheque Range", 264],
      ["bankTransactionId", "Bank Allocations - Transaction ID", 265],
      ["bankLedgerName", "Bank Allocations - Ledger Name", 266],
      ["bankTransferMode", "Bank Allocations - Transfer Mode", 267],
      ["bankPdcIssueDate", "Bank Allocations - PDC Issue Date", 268, "date"],
      ["bankPdcNote", "Bank Allocations - PDC Note", 269],
      ["bankPayableLocation", "Bank Allocations - Payable Location", 270],
      ["bankPrintLocation", "Bank Allocations - Print Location", 271],
      ["bankDate", "Bank Allocations - Bank Date", 272, "date"],
    ],
  },
  {
    section: "Point of Sale Details", level: "voucher", x: "notApplicable", why: "Point-of-sale invoices.",
    dependency: recordOnly("No payment is tendered, and nothing is recorded in the cash, card or bank books."),
    rows: [
      ["posGiftVoucher", "POS Details - Gift Voucher", 274],
      ["posGiftVoucherAmount", "POS Details - Gift Voucher Amount", 275, "amount"],
      ["posCard", "POS Details - Credit/Debit Card", 276],
      ["posCardAmount", "POS Details - Credit/Debit Card Amount", 277, "amount"],
      ["posCardNumber", "POS Details - Credit/Debit Card Number", 278],
      ["posCheque", "POS Details - Cheque", 279],
      ["posChequeAmount", "POS Details - Cheque Amount", 280, "amount"],
      ["posBankName", "POS Details - Bank Name", 281],
      ["posChequeNumber", "POS Details - Cheque Number", 282],
      ["posCashLedgerName", "POS Details - Cash Ledger Name", 283],
      ["posCashAmount", "POS Details - Cash Amount", 284, "amount"],
      ["posCashTendered", "POS Details - Cash tendered", 285, "amount"],
    ],
  },
  {
    section: "Advance Payment/Receipt/Refund Details", level: "voucher", x: "notApplicable", why: "An advance against an order is a receipt voucher of its own, recorded separately.",
    group: "advancePayments", dependency: rows("order, one row per stock item. No advance is received or adjusted: that is a receipt voucher of its own."),
    rows: (
      [
        ["advLedgerName", "Ledger Name"],
        ["advStockItemName", "Stock Item Name"],
        ["advItemQuantity", "Item Quantity", "number"],
        ["advItemRate", "Item Rate", "amount"],
        ["advAmount", "Advance Amount", "amount"],
        ["advTaxableValue", "Taxable Value", "amount"],
        ["advIgstRate", "IGST Rate", "percent"],
        ["advIgstAmount", "IGST Amount", "amount"],
        ["advSgstRate", "SGST Rate", "percent"],
        ["advSgstAmount", "SGST Amount", "amount"],
        ["advCgstRate", "CGST Rate", "percent"],
        ["advCgstAmount", "CGST Amount", "amount"],
        ["advCessRate", "Cess Rate", "percent"],
        ["advCessAmount", "Cess Amount", "amount"],
        ["advCessPerUnitRate", "Cess Rate Per Unit", "amount"],
        ["advCessPerUnitAmount", "Cess per Unit Amount", "amount"],
      ] as const
    ).map(([key, name, type], i): Row => [key, `Advance Payment/Receipt/Refund Details - ${name}`, 287 + i, type]),
  },
  {
    section: "Tax Type Allocations", level: "ledger", x: "notApplicable", why: STATUTORY_WHY,
    group: "taxTypeAllocations", dependency: rows("ledger entry, one row per tax type. No statutory payment or liability is posted."),
    rows: [
      ["taxTypeName", "Tax Type Allocations - Tax Type", 304],
      ["taxTypeAmount", "Tax Type Allocations - Amount", 305, "amount"],
      ["taxTypeNatureOfPayment", "Tax Type Allocations Additional Details - Nature of Payment", 306],
      ["taxTypeAdditionalAmount", "Tax Type Allocations Additional Details - Amount", 307, "amount"],
      ["taxTypeIgstLiability", "Tax Type Allocations - IGST Liability", 308, "amount"],
      ["taxTypeCgstLiability", "Tax Type Allocations - CGST Liability", 309, "amount"],
      ["taxTypeSgstLiability", "Tax Type Allocations - SGST/UTGST Liability", 310, "amount"],
      ["taxTypeCessLiability", "Tax Type Allocations - Cess Liability", 311, "amount"],
    ],
  },
  {
    section: "GST Advance Adjustment Details", level: "voucher", x: "notApplicable", why: "GST on advances: receipt and journal vouchers.",
    dependency: recordOnly("No advance is adjusted against GST."),
    rows: [
      ["gstAdvMonthYear", "GST Advance Details - Month Year", 313],
      ["gstAdvPlaceOfSupply", "GST Advance Details - Place of Supply", 314],
      ["gstAdvGstRate", "GST Advance Details - GST Rate", 315, "percent"],
      ["gstAdvCessRate", "GST Advance Details - Cess Rate", 316, "percent"],
      ["gstAdvAmount", "GST Advance Details - Advance Amount", 317, "amount"],
    ],
  },
  {
    section: "TDS Nature of Payment Details", level: "ledger", x: "notApplicable", why: TAX_DEDUCTION_WHY, dependency: NO_TAX,
    rows: [
      ["tdsNatureOfPayment", "TDS - Nature of Payments", 319],
      ["tdsAssessableValue", "TDS - Assessable Value", 320, "amount"],
      ["tdsOverrideExemption", "Override TDS Exemption u/s 206C", 321, "yesno"],
    ],
  },
  {
    section: "TDS Party Details", level: "voucher", x: "notApplicable", why: TAX_DEDUCTION_WHY, dependency: NO_TAX,
    rows: [
      ["tdsPartyName", "TDS Party Details - Party Name", 323],
      ["tdsPartyDeducteeType", "TDS Party Details - Deductee Type", 324],
      ["tdsPartyPan", "TDS Party Details - PAN Number", 325],
    ],
  },
  { section: "TDS Bill Allocations", level: "ledger", x: "notApplicable", why: TAX_DEDUCTION_WHY, group: "tdsBillAllocations", dependency: rows("ledger entry, one row per TDS bill. No TDS is worked out or deducted."), rows: billAllocations("tdsBill", "TDS Bill Allocations", 327, "TDS Nature of Payment", "Expenses Ledger") },
  {
    section: "TCS Nature of Goods Details", level: "ledger", x: "notApplicable", why: TAX_DEDUCTION_WHY, dependency: NO_TAX,
    rows: [
      ["tcsNatureOfGoods", "TCS - Nature of Goods", 337],
      ["tcsAssessableValue", "TCS - Assessable Value", 338, "amount"],
      ["tcsExemptionBuyerTds", "Exemption from TCS for Buyer-Deductible TDS", 339, "yesno"],
    ],
  },
  {
    section: "TCS Party Details", level: "voucher", x: "notApplicable", why: TAX_DEDUCTION_WHY, dependency: NO_TAX,
    rows: [
      ["tcsPartyName", "TCS Party Details - Party Name", 341],
      ["tcsPartyCollecteeType", "TCS Party Details - Collectee Type", 342],
      ["tcsPartyPan", "TCS Party Details - PAN Number", 343],
    ],
  },
  { section: "TCS Bill Allocations", level: "ledger", x: "notApplicable", why: TAX_DEDUCTION_WHY, group: "tcsBillAllocations", dependency: rows("ledger entry, one row per TCS bill. No TCS is worked out or collected."), rows: billAllocations("tcsBill", "TCS Bill Allocations", 345, "TCS Nature of Goods", "Income Ledger") },
  {
    section: "Stat Adjustment (GST) Details", level: "voucher", x: "notApplicable", why: STATUTORY_WHY, dependency: NO_STATUTORY,
    rows: [
      ["statPayGstTaxType", "Stat Payment (GST) - Tax Type", 355],
      ["statPayGstPaymentType", "Stat Payment (GST) - Type of Payment", 356, "choice", ["Not Applicable", "Advance Payment Under Reverse Charge", "Payment Under Reverse Charge", "Refund of Advance Receipt"]],
      ["statPayGstPeriodFrom", "Stat Payment (GST) - Period From", 357, "date"],
      ["statPayGstPeriodTo", "Stat Payment (GST) - Period To", 358, "date"],
    ],
  },
  {
    section: "Stat Adjustment (TDS) Details", level: "voucher", x: "notApplicable", why: STATUTORY_WHY, dependency: NO_STATUTORY,
    rows: [["statAdjTdsNature", "Stat Adjustment (TDS) - Nature of Payment", 360, "choice", ["Not Applicable", "Advance Payment for TDS Expenses"]]],
  },
  {
    section: "Stat Adjustment (TCS) Details", level: "voucher", x: "notApplicable", why: STATUTORY_WHY, dependency: NO_STATUTORY,
    rows: [["statAdjTcsNature", "Stat Adjustment (TCS) - Nature of Receipt", 362, "choice", ["Not Applicable", "Advance Receipt for TCS Sales"]]],
  },
  { section: "Stat Payment (TDS) Details", level: "voucher", x: "notApplicable", why: STATUTORY_WHY, dependency: NO_STATUTORY, rows: statPayment("statPayTds", "Stat Payment (TDS)", 364, "Nature of Payment") },
  { section: "Stat Payment (TCS) Details", level: "voucher", x: "notApplicable", why: STATUTORY_WHY, dependency: NO_STATUTORY, rows: statPayment("statPayTcs", "Stat Payment (TCS)", 379, "Nature of Goods") },
];

/** What the import and the form check of a value, by type, in words. */
const CHECK: Readonly<Record<SoFieldType, string>> = {
  text: "", date: " A real date.", amount: " An amount of 0 or more.", number: " A number of 0 or more.", percent: " 0 to 100.", yesno: " Yes or No.", choice: " One of the listed values.",
  gstin: "", state: "", pincode: "", hsn: "",
};

/** The cash/trade discount is part of the line's amount (./sales-orders → lineExpected; ./sales-order-form → itemAmountPaise). */
const CASH_TRADE_RULE: Readonly<Record<string, string>> = {
  cashTradeDiscRate: "Optional once enabled. 0 to 100. Taken off the line after its Disc% and Discount Amount: the Item Amount is quantity × rate less those, less this percentage of what remains, less the Discount Amount (Cash/Trade). The line's allocations add up to its value before the cash/trade discount.",
  cashTradeDiscAmount: "Optional once enabled. An amount of 0 or more, taken off the line last (after the Discount Rate (Cash/Trade)).",
};

export const SO_PROVISION_FIELDS: readonly SoField[] = GROUPS.flatMap((g) =>
  g.rows.map(
    ([key, tallyName, matrixRow, type = "text", options]): SoField => ({
      key,
      tallyName,
      label: tallyName,
      section: g.section,
      requirement: "provision",
      level: g.level,
      type,
      ...(type === "yesno" ? { options: ["Yes", "No"] as const } : options ? { options } : {}),
      keyed: true,
      defaultOff: true,
      outsideMatrix: `Marked x for Sales Orders in the Read Me (${g.why.replace(/\.$/, "")}). Off unless an administrator enables it in Admin & Master Setup → Sales Order Fields.`,
      xVerdict: { status: g.x, why: g.why },
      ...(g.dependency ? { dependency: g.dependency } : {}),
      ...(g.group ? { group: g.group } : {}),
      rule: CASH_TRADE_RULE[key] ?? `Optional once enabled.${CHECK[type]}${g.group ? " One value per row of the group." : ""}`,
      matrixRow,
    }),
  ),
);
