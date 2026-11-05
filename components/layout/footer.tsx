/**
 * The copyright line at the bottom of every page. Rendered once per section by
 * the shared layouts — the WMS route template (app/(app)/template.tsx) and each
 * module's layout — never by individual pages. The "Powered by Altus Corp" mark
 * lives in the left rail, above Back to Hub (components/layout/powered-by.tsx).
 * Hidden when printing, as the old branded footer was on printable pages.
 */
export function DashboardFooter() {
  return (
    <footer className="mt-10 shrink-0 border-t border-hairline px-6 py-4 text-center print:hidden max-md:px-4" data-testid="site-footer">
      <p className="text-[12.5px] text-ink-subtle">© Altus Corp 2025–2035 · All rights reserved</p>
    </footer>
  );
}
