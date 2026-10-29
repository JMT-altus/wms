import "server-only";
import { getCurrentEmployee, requireAdmin } from "@/lib/auth/current";
import { getMyFieldAccess } from "@/lib/auth/field-access";
import { PERMISSION_FIELDS, type PermissionFieldKey } from "@/db/enums";

/**
 * Capabilities — permissions from the existing permission matrix
 * (/master-setup/access-control; registry `PERMISSION_FIELDS`, grants in
 * `field_permission_grants`), resolved by the same `resolveFieldAccess` the
 * matrix previews with.
 *
 * Who is asking always comes from the signed session (getCurrentEmployee, by
 * Firebase UID); a signed-out or inactive employee holds nothing. A caller
 * can't supply an employee id, email or flag — nothing here reads the request
 * payload. Decisions are read per request, so a revoked grant stops working on
 * the next request.
 */

declare const capabilityBrand: unique symbol;

/**
 * Proof that the current request holds capability `K`. Only this module can
 * create one; queries that touch protected data require the proof for their
 * capability, so they can't be reached from a path that skipped the check.
 */
export type CapabilityProof<K extends PermissionFieldKey> = {
  readonly employeeId: string;
  readonly capability: K;
  readonly [capabilityBrand]: true;
};

/** Collection capabilities (the `collection.*` keys of the registry). */
export type CollectionCapability = Extract<PermissionFieldKey, `collection.${string}`>;

export const COLLECTION_CAPABILITIES: readonly CollectionCapability[] = PERMISSION_FIELDS.map((f) => f.key).filter(
  (k): k is CollectionCapability => k.startsWith("collection."),
);

/** Leave-approval capabilities (the `leave.approvals.*` keys of the registry). */
export type LeaveCapability = Extract<PermissionFieldKey, `leave.approvals.${string}`>;

export const LEAVE_CAPABILITIES: readonly LeaveCapability[] = PERMISSION_FIELDS.map((f) => f.key).filter(
  (k): k is LeaveCapability => k.startsWith("leave.approvals."),
);

/** The proof for `key`, or "Forbidden" before anything else is read or written. */
export async function requireCapability<K extends PermissionFieldKey>(key: K): Promise<CapabilityProof<K>> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) throw new Error("Forbidden");
  const access = await getMyFieldAccess();
  if (access[key]?.allowed !== true) throw new Error("Forbidden");
  return { employeeId: me.id, capability: key } as CapabilityProof<K>;
}

/**
 * Collection guard. The Forms area that hosts Collection is admin-only (its
 * layout calls requireAdmin, and Client KYC shares it), so this keeps that gate
 * and then requires the specific capability. Both happen before any Collection
 * data is read or written; anyone else gets "Forbidden".
 */
export async function requireCollectionCapability<K extends CollectionCapability>(key: K): Promise<CapabilityProof<K>> {
  await requireAdmin();
  return requireCapability(key);
}

/** Same, without throwing: the proof, or null. For pages that render a "no access" state. */
export async function getCollectionCapability<K extends CollectionCapability>(key: K): Promise<CapabilityProof<K> | null> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive || !me.isAdmin) return null;
  const access = await getMyFieldAccess();
  return access[key]?.allowed === true ? ({ employeeId: me.id, capability: key } as CapabilityProof<K>) : null;
}

/** Every Collection capability of the current request — for deciding what UI to render (the server checks again). */
export async function getCollectionCapabilities(): Promise<Record<CollectionCapability, boolean>> {
  const me = await getCurrentEmployee();
  const admin = !!me && me.isActive && me.isAdmin;
  const access = admin ? await getMyFieldAccess() : {};
  return Object.fromEntries(COLLECTION_CAPABILITIES.map((k) => [k, admin && access[k]?.allowed === true])) as Record<CollectionCapability, boolean>;
}

/**
 * Same as `requireCapability`, without throwing: the proof, or null. Unlike the
 * Collection helpers it adds no admin gate — a grant to an ordinary employee is
 * honoured, because that is what the matrix says. A signed-out or inactive
 * employee holds nothing.
 */
export async function getCapability<K extends PermissionFieldKey>(key: K): Promise<CapabilityProof<K> | null> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return null;
  const access = await getMyFieldAccess();
  return access[key]?.allowed === true ? ({ employeeId: me.id, capability: key } as CapabilityProof<K>) : null;
}

/** The leave-approval proofs of the current request, for the page and the actions. */
export async function getLeaveCapabilityProofs(): Promise<{
  view: CapabilityProof<"leave.approvals.view"> | null;
  decide: CapabilityProof<"leave.approvals.decide"> | null;
  override: CapabilityProof<"leave.approvals.override"> | null;
}> {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { view: null, decide: null, override: null };
  const access = await getMyFieldAccess();
  const proof = <K extends LeaveCapability>(key: K) =>
    access[key]?.allowed === true ? ({ employeeId: me.id, capability: key } as CapabilityProof<K>) : null;
  return { view: proof("leave.approvals.view"), decide: proof("leave.approvals.decide"), override: proof("leave.approvals.override") };
}

/**
 * Which of `keys` the current request holds — only to decide what navigation to
 * draw (the page and the actions check again). A failed read shows less, never
 * more, and never breaks the page it sits on.
 */
export async function getHeldCapabilities(keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  try {
    const me = await getCurrentEmployee();
    if (!me || !me.isActive) return [];
    const access = await getMyFieldAccess();
    return keys.filter((k) => access[k]?.allowed === true);
  } catch (err) {
    console.error("[capability] navigation check failed", err);
    return [];
  }
}
