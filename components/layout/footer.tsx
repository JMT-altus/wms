/**
 * The copyright line at the bottom of every page. Rendered once per section by
 * the shared layouts — the WMS route template (app/(app)/template.tsx) and each
 * module's layout — never by individual pages. The "Powered by Altus Corp" mark
 * lives in the left rail, above Back to Hub (components/layout/powered-by.tsx).
 * Hidden when printing, as the old branded footer was on printable pages.
 *
 * Always at the bottom of the window: it is the last item of a full-height
 * page column (the WMS template's .app-page, each module shell's content
 * column), so a short page puts it at the bottom, and `sticky bottom-0` keeps
 * it there while a long page scrolls. Being sticky, not fixed, it stays in the
 * page's flow — the end of every page scrolls clear of it, nothing is hidden
 * behind it — and it is exactly as wide as the content column, never over the
 * sidebar. Dialogs, menus and toasts render in portals above it (z-50 and up).
 */
export function DashboardFooter() {
  return (
    <footer
      className="site-footer sticky bottom-0 z-[15] flex h-9 shrink-0 items-center justify-center border-t border-[#E2E8F0] bg-[#F7F9FC] px-6 text-center print:hidden max-md:px-4"
      data-testid="site-footer"
    >
      <p className="text-[12px] text-[#64748B]">© Altus Corp 2025–2035 · All rights reserved</p>
    </footer>
  );
}
