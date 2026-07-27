import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { statusSettings } from "@/db/schema";
import { CACHE_TAGS } from "@/lib/cache-tags";
import type { TaskStatus } from "@/db/enums";
import {
  mergeStatusDisplay,
  type StatusDisplay,
  type StatusDisplayMap,
} from "./status-display-merge";

export type { StatusDisplay, StatusDisplayMap };
export { mergeStatusDisplay };

// Status overrides are admin-managed and change rarely. Hit Postgres at
// most once per hour per region; admins invalidate immediately via
// revalidateTag(CACHE_TAGS.statusSettings) in /admin/settings actions.
// The outer `cache()` dedupes within a single request so multiple
// callers in one render share the same Promise.
const fetchStatusDisplayMap = unstable_cache(
  async (): Promise<StatusDisplayMap> => {
    const rows = await db
      .select({
        status: statusSettings.status,
        label: statusSettings.label,
        colorToken: statusSettings.colorToken,
      })
      .from(statusSettings);
    return mergeStatusDisplay(rows);
  },
  ["status-display-map"],
  { tags: [CACHE_TAGS.statusSettings], revalidate: 3600 },
);

export const getStatusDisplayMap = cache(fetchStatusDisplayMap);

export interface StatusMeta {
  status: TaskStatus;
  label: string;
  colorToken: string;
  active: boolean;
  displayOrder: number;
}

// Ordered list of statuses with hide/show + order — for the admin manager and
// for pickers to know which statuses are selectable and in what order.
const fetchStatusList = unstable_cache(
  async (): Promise<StatusMeta[]> => {
    return db
      .select({
        status: statusSettings.status,
        label: statusSettings.label,
        colorToken: statusSettings.colorToken,
        active: statusSettings.active,
        displayOrder: statusSettings.displayOrder,
      })
      .from(statusSettings)
      .orderBy(statusSettings.displayOrder);
  },
  ["status-list"],
  { tags: [CACHE_TAGS.statusSettings], revalidate: 3600 },
);

export const getStatusList = cache(fetchStatusList);
