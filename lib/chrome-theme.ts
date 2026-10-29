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
 * Pages outside WMS that use the white shell too: the Salary module (admin
 * runs and the employee's My Salary), styled after the Altus payroll screens.
 */
const LIGHT_CHROME_PREFIXES = ["/salary", "/my-salary"];

const under = (pathname: string, prefixes: readonly string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));

/**
 * True when the shared rail + header should use the white-and-blue theme.
 * Presentation only — nothing else keys off this.
 */
export function isLightChrome(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (under(pathname, DARK_CHROME_PREFIXES)) return false;
  if (under(pathname, LIGHT_CHROME_PREFIXES)) return true;
  return moduleForPath(pathname).id === "wms";
}
