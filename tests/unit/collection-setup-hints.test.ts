import { describe, expect, it } from "vitest";
import { FIELD_PERMISSIONS_HREF, SETUP_HINT_KEYS, buildSetupHints } from "@/lib/collections/setup-hints";

// The super-admin's "setup needed" notice: pure rules. It only describes a gap — it never grants anything.
const nobody = { people: 0, orgWide: false };

describe("buildSetupHints", () => {
  it("names the missing review grant when escalations are waiting and no one holds it", () => {
    const hints = buildSetupHints({ openEscalations: 1, unassignedParties: 0, holders: { "collection.escalation.review": nobody, "collection.coordinator.assign": nobody } });
    expect(hints.map((h) => h.key)).toEqual(["collection.escalation.review"]);
    expect(hints[0]!.text).toMatch(/1 escalation is waiting.*“Review escalations”.*nobody can see it/);
  });

  it("names the missing assign grant when parties are unassigned and no one holds it (formatted counts, plural)", () => {
    const hints = buildSetupHints({ openEscalations: 0, unassignedParties: 1309, holders: { "collection.escalation.review": nobody, "collection.coordinator.assign": nobody } });
    expect(hints.map((h) => h.key)).toEqual(["collection.coordinator.assign"]);
    expect(hints[0]!.text).toMatch(/1,309 parties have no Sales Coordinator.*“Assign Sales Coordinator”/);
  });

  it("says nothing when someone holds the grant — by a person-level Allow or an organisation-wide Allow", () => {
    expect(buildSetupHints({ openEscalations: 3, unassignedParties: 5, holders: { "collection.escalation.review": { people: 1, orgWide: false }, "collection.coordinator.assign": { people: 0, orgWide: true } } })).toEqual([]);
  });

  it("says nothing when there is no work waiting, even if no one holds the grant", () => {
    expect(buildSetupHints({ openEscalations: 0, unassignedParties: 0, holders: { "collection.escalation.review": nobody, "collection.coordinator.assign": nobody } })).toEqual([]);
  });

  it("says nothing when the grants could not be read (never guesses)", () => {
    expect(buildSetupHints({ openEscalations: 4, unassignedParties: 9, holders: null })).toEqual([]);
  });

  it("treats a missing entry as 'no holder'; both hints can appear together", () => {
    expect(buildSetupHints({ openEscalations: 2, unassignedParties: 7, holders: {} }).map((h) => h.key)).toEqual(SETUP_HINT_KEYS.slice());
  });

  it("contains no names, e-mails or ids — only capability labels — and points at Field Permissions", () => {
    const text = JSON.stringify(buildSetupHints({ openEscalations: 2, unassignedParties: 7, holders: {} }));
    expect(text).not.toMatch(/@|mihir|[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(FIELD_PERMISSIONS_HREF).toBe("/master-setup/access-control");
  });
});
