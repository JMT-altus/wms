/**
 * The header's page title, "Module · Page" or "Module ▸ Page", split into its
 * parts so the module reads a notch stronger than the page and the separator
 * sits quietly between them. Pure.
 */
export type TitlePart = { kind: "module" | "page" | "separator"; text: string };

export function splitHeaderTitle(title: string): TitlePart[] {
  const parts = title.split(/\s([·▸])\s/);
  return parts.map((text, i) => ({ kind: i % 2 === 1 ? "separator" : i === 0 ? "module" : "page", text }));
}
