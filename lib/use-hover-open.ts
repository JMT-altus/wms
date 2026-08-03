"use client";
import * as React from "react";

/**
 * Grace period between the pointer leaving and the menu closing.  The dropdown
 * is portaled and sits a few px below its chip, so without this the menu would
 * snap shut in the gap on the way to it.
 */
const CLOSE_GRACE_MS = 160;

/**
 * Slack around the chip and menu rects when deciding "is the pointer still on
 * this thing".  Covers the popover's 8px side offset so the dead space between
 * the two counts as being on them.
 */
const HIT_PAD = 12;

function pointWithin(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return (
    x >= r.left - HIT_PAD &&
    x <= r.right + HIT_PAD &&
    y >= r.top - HIT_PAD &&
    y <= r.bottom + HIT_PAD
  );
}

/**
 * Open-on-hover state for a Radix popover.
 *
 * Opt-in per call site: hovering to open suits a filter bar, where you're
 * skimming several menus in a row, but is a nuisance inside a form or dialog
 * where a menu popping open as the pointer crosses it interrupts typing.
 *
 * Closing is driven by where the pointer ACTUALLY is (a document-level
 * pointermove checked against the live rects of the chip and the menu), not by
 * `pointerleave` alone.  That distinction matters: selecting an option
 * re-renders the menu and can resize the chip underneath a stationary cursor,
 * which fires a spurious leave and would otherwise close the menu mid-click.
 *
 * Callers must register the chip via `setAnchor` and the popover content via
 * `setContent`, and spread `hoverProps` on the chip so there's something to
 * open it.
 */
export function useHoverOpen(enabled: boolean) {
  const [open, setOpenState] = React.useState(false);
  const openRef = React.useRef(false);
  /** How the CURRENT open happened. Callers use it to skip focus management,
   *  since yanking focus around on mere mouse movement is hostile. */
  const openedByHover = React.useRef(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The chip. Registered by the caller — see MultiSelect for the
   *  `.filter-chip` case. */
  const anchorRef = React.useRef<HTMLElement | null>(null);
  /** The portaled popover content. */
  const contentRef = React.useRef<HTMLElement | null>(null);

  // Callback refs rather than exposing the refs themselves: the caller stays
  // out of the business of mutating hook state, and these drop straight into
  // `ref={...}` without touching `.current` during render.
  const setAnchor = React.useCallback((el: HTMLElement | null) => {
    anchorRef.current = el;
  }, []);
  const setContent = React.useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const apply = React.useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);

  /** Radix's own path: click, Escape, outside press. */
  const setOpen = React.useCallback(
    (next: boolean) => {
      cancelClose();
      // Opening from a click means focus SHOULD move into the menu.
      if (next) openedByHover.current = false;
      apply(next);
    },
    [apply, cancelClose],
  );

  const enter = React.useCallback(() => {
    if (!enabled) return;
    cancelClose();
    if (!openRef.current) openedByHover.current = true;
    apply(true);
  }, [enabled, apply, cancelClose]);

  const scheduleClose = React.useCallback(() => {
    if (!enabled || closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      apply(false);
      // `openedByHover` is deliberately left alone — the close handlers still
      // need to know how this menu was opened.
    }, CLOSE_GRACE_MS);
  }, [enabled, apply]);

  /** Kept for the fast path; the pointermove watcher below is the real guard. */
  const leave = React.useCallback(() => {
    if (!enabled) return;
    scheduleClose();
  }, [enabled, scheduleClose]);

  // While open, the pointer's real position decides. Every move re-tests it
  // against the CURRENT rects, so a menu that repositions or a chip that
  // resizes mid-interaction can't strand a stale "you left" verdict.
  React.useEffect(() => {
    if (!enabled || !open) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const inside =
        pointWithin(anchorRef.current, e.clientX, e.clientY) ||
        pointWithin(contentRef.current, e.clientX, e.clientY);
      if (inside) cancelClose();
      else scheduleClose();
    };
    // Pointer left the window entirely — nothing more will arrive, so close.
    const onWindowOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) scheduleClose();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onWindowOut, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onWindowOut);
    };
  }, [enabled, open, cancelClose, scheduleClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  // Touch and pen fire pointerenter on tap, which would open and then instantly
  // close the menu under a finger. Those pointers use the normal click path.
  const hoverProps = React.useMemo(
    () => ({
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") enter();
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") leave();
      },
    }),
    [enter, leave],
  );

  /**
   * Spread on the popover content alongside `hoverProps`.
   *
   * Suppressing auto-focus keeps the menu from stealing focus on mere mouse
   * movement — but it also leaves focus on the chip, OUTSIDE the content. cmdk
   * options aren't focusable, so clicking one sends focus to <body>, which
   * Radix reads as "focus left the popover" and dismisses on. Hence
   * onFocusOutside: while hover-opened, focus is never inside to begin with,
   * so focus moving around is not a signal that the user is done. The pointer
   * watcher, Escape and outside-clicks still close it.
   */
  const contentDismissProps = React.useMemo(
    () => ({
      onOpenAutoFocus: (e: Event) => {
        if (openedByHover.current) e.preventDefault();
      },
      onCloseAutoFocus: (e: Event) => {
        if (openedByHover.current) e.preventDefault();
      },
      onFocusOutside: (e: { preventDefault: () => void }) => {
        if (openedByHover.current) e.preventDefault();
      },
    }),
    [],
  );

  return {
    open,
    setOpen,
    setAnchor,
    setContent,
    enter,
    leave,
    hoverProps,
    contentDismissProps,
  };
}
