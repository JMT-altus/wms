/**
 * "Setup needed" hints for the Collection Tracker — pure. Sensitive Collection
 * capabilities are never implied by admin or super-admin status; a super-admin
 * grants them to named people in Field Permissions. When work is waiting that
 * nobody is currently allowed to handle, the Tracker tells the super-admin what
 * to grant and where, instead of the feature silently being invisible.
 *
 * Nothing here grants anything: it only describes the gap.
 */
export const SETUP_HINT_KEYS = ["collection.escalation.review", "collection.coordinator.assign"] as const;
export type SetupHintKey = (typeof SETUP_HINT_KEYS)[number];

/** Who currently holds a capability by an explicit grant. */
export interface CapabilityHolders {
  /** Active admins with a person-level Allow. */
  people: number;
  /** An organisation-wide Allow exists. */
  orgWide: boolean;
}

export interface SetupHint {
  key: SetupHintKey;
  text: string;
}

export const FIELD_PERMISSIONS_HREF = "/master-setup/access-control";

const noHolder = (h: CapabilityHolders | undefined): boolean => !h || (h.people === 0 && !h.orgWide);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

export function buildSetupHints(input: {
  openEscalations: number;
  unassignedParties: number;
  /** null = the grants could not be read: show nothing rather than guess. */
  holders: Partial<Record<SetupHintKey, CapabilityHolders>> | null;
}): SetupHint[] {
  if (!input.holders) return [];
  const hints: SetupHint[] = [];
  if (input.openEscalations > 0 && noHolder(input.holders["collection.escalation.review"])) {
    hints.push({
      key: "collection.escalation.review",
      text: `${plural(input.openEscalations, "escalation is", "escalations are")} waiting, but no one has been granted “Review escalations”, so nobody can see ${input.openEscalations === 1 ? "it" : "them"}. Allow it (and “Close escalations”) for the reviewer.`,
    });
  }
  if (input.unassignedParties > 0 && noHolder(input.holders["collection.coordinator.assign"])) {
    hints.push({
      key: "collection.coordinator.assign",
      text: `${plural(input.unassignedParties, "party has", "parties have")} no Sales Coordinator, but no one has been granted “Assign Sales Coordinator”, so the Collection Person dropdown isn't shown to anyone. Allow it for the person who should assign them.`,
    });
  }
  return hints;
}
