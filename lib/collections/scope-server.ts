import "server-only";
import { cache } from "react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getMyFieldAccess } from "@/lib/auth/field-access";
import { salespersonIdentityFor } from "./salesperson-identity";
import type { CollectionScope } from "./scope";

/**
 * The Collection scope of the current request (see lib/collections/scope.ts
 * for the rule), decided once per request from the verified session:
 *   - a super-admin (lib/auth/super-admin.ts, the existing resolver) → "all";
 *   - a holder of collection.tracker.view_all ("View All Collection Person
 *     Data", granted per person in the permission matrix — nobody is named in
 *     code) → "all", the same view as a super-admin;
 *   - a login linked to a Sales Coordinator label through the super-admin-kept
 *     link (collection_coordinator_links) → that coordinator's companies;
 *   - anyone else (no link, marked "not a Sales Coordinator", link table not
 *     installed, signed out) → "none".
 * Nothing from the browser — an id, a name, a label, a URL parameter — can
 * widen it; an admin who is not a super-admin is an ordinary login here.
 */
export const collectionScopeFor = cache(async (): Promise<CollectionScope> => {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return { kind: "none", reason: "signed-out" };
  if (isSuperAdmin(me.email)) return { kind: "all" };
  // An explicit grant, read from the signed session like every capability; revoking it narrows the next request.
  if ((await getMyFieldAccess())["collection.tracker.view_all"]?.allowed === true) return { kind: "all" };
  const identity = await salespersonIdentityFor(me);
  if (identity.status === "linked") return { kind: "coordinator", label: identity.label };
  return { kind: "none", reason: identity.status };
});
