import type { StatusMeta } from "@/lib/queries/status-display";
import { StatusManager } from "./status-manager";

type Props = { statuses: StatusMeta[] };

export function SettingsTabStatuses({ statuses }: Props) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-display-xs mb-2">Task Statuses</h2>
      <p className="text-body text-ink-subtle mb-6">
        Rename, recolour (palette or a custom hex), reorder with the arrows, and
        hide/show any status. Hiding removes it from the status pickers while
        existing tasks keep their value. Changes reflect on the dashboard,
        emails, and integrations everywhere.
      </p>
      <StatusManager initial={statuses} />
    </div>
  );
}
