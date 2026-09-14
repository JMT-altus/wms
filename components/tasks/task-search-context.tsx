"use client";
import * as React from "react";

/** The task list's free-text search, lifted out of the table so the input can
 *  live in the filter bar while the filtering still happens in the table.
 *
 *  Deliberately NOT a URL param like the other filters: the search runs
 *  client-side over rows that are already loaded, so routing it through the
 *  query string would cost a server round-trip per keystroke and return the
 *  identical rows.
 */
type TaskSearch = { query: string; setQuery: (v: string) => void };

const TaskSearchContext = React.createContext<TaskSearch | null>(null);

export function TaskSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = React.useState("");
  const value = React.useMemo(() => ({ query, setQuery }), [query]);
  return (
    <TaskSearchContext.Provider value={value}>{children}</TaskSearchContext.Provider>
  );
}

/** Null outside a provider. The filter bar also renders on pages with no task
 *  list (dashboard, kanban), and there the search box simply isn't drawn —
 *  same for a table rendered without the bar, which keeps its own input. */
export function useTaskSearch(): TaskSearch | null {
  return React.useContext(TaskSearchContext);
}
