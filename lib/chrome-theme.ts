import { moduleForPath } from "@/lib/nav-modules";

/**
 * Areas that render their own navy rail (or sit outside the WMS module) and
 * keep the dark chrome. Everything else in WMS gets the white-and-blue shell.
 */
const DARK_CHROME_PREFIXES = [
  "/forms",
  "/admin",
  "/master-setup",
  "/masters",
  "/project-plan",
  "/targets",
];

/**
 * True when the shared rail + header should use the white-and-blue theme.
 * Presentation only — nothing else keys off this.
 */
export function isLightChrome(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (DARK_CHROME_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return false;
  return moduleForPath(pathname).id === "wms";
}
