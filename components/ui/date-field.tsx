"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { DATE_PLACEHOLDER, fmtDate, parseDmy } from "@/lib/dates";

/**
 * The WMS date entry field: typed as dd/mm/yy, picked from the native
 * calendar, stored as "yyyy-mm-dd".
 *
 * A drop-in for `<input type="date">`. The value in and out is always ISO
 * ("yyyy-mm-dd" or ""), so state, validation, URLs and server actions keep
 * working unchanged; only what the person sees and types is dd/mm/yy. The
 * browser's own date input shows whatever the OS locale says (often
 * mm/dd/yyyy), which is why the visible text is ours; the native control
 * still sits invisibly over the calendar button so one tap opens the usual
 * picker, with `min` / `max` honoured there too.
 *
 * Validation mirrors the native input: `required` blocks an empty field,
 * an unreadable or impossible date (31/02/26) or one outside min/max sets a
 * custom validity message so the form will not submit and the field reads
 * aria-invalid. With `name`, a hidden input carries the ISO value for
 * FormData.
 */
export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> {
  /** "yyyy-mm-dd" or "". */
  value?: string;
  defaultValue?: string;
  /** Fires with "yyyy-mm-dd" when a full valid date is entered or picked, "" when cleared. */
  onChange?: (iso: string) => void;
  /** "yyyy-mm-dd". */
  min?: string;
  max?: string;
}

// Tailwind tokens that size or place the field belong on the wrapper, so a
// caller's `w-40` or `flex-1` keeps working; everything else styles the text.
const LAYOUT = /^(!?)(w-|min-w-|max-w-|flex-|flex$|grow|shrink|basis-|col-span-|row-span-|self-|justify-self-|m[trblxy]?-|-m[trblxy]?-|order-)/;
const BREAKPOINT = /^(sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl):(.+)$/;
function splitClassName(className?: string): { wrapper: string; input: string } {
  const wrapper: string[] = [];
  const input: string[] = [];
  for (const t of (className ?? "").split(/\s+/).filter(Boolean)) {
    const bare = BREAKPOINT.exec(t)?.[2] ?? t;
    (LAYOUT.test(bare) ? wrapper : input).push(t);
  }
  return { wrapper: wrapper.join(" "), input: input.join(" ") };
}

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { value, defaultValue, onChange, min, max, name, className, placeholder, disabled, readOnly, required, onBlur, onFocus, onKeyDown, id, ...rest },
  ref,
) {
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const iso = controlled ? value : inner;

  const [text, setText] = React.useState(() => fmtDate(iso));
  const [editing, setEditing] = React.useState(false);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // While not being typed in, the text always mirrors the value.
  const shown = editing ? text : fmtDate(iso);

  const setRefs = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const boundsMessage = (v: string): string | null => {
    if (min && v < min) return `Enter a date on or after ${fmtDate(min)}`;
    if (max && v > max) return `Enter a date on or before ${fmtDate(max)}`;
    return null;
  };

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ?? "");
  }, [invalid]);

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    if (next !== iso) onChange?.(next);
    setInvalid(next ? boundsMessage(next) : null);
  };

  const handleText = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") {
      commit("");
      return;
    }
    const parsed = parseDmy(raw);
    if (parsed) commit(parsed);
    else setInvalid(`Enter a date as ${DATE_PLACEHOLDER}`);
  };

  const finish = () => {
    setEditing(false);
    const parsed = text.trim() === "" ? "" : parseDmy(text);
    if (parsed === null) {
      // Unreadable text stays visible so the person can fix it; the field is invalid until then.
      setEditing(true);
      setInvalid(`Enter a date as ${DATE_PLACEHOLDER}`);
      return;
    }
    commit(parsed);
  };

  const { wrapper, input } = splitClassName(className);

  return (
    <span className={`relative inline-block align-middle ${wrapper}`.trim()}>
      <input
        {...rest}
        ref={setRefs}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={shown}
        placeholder={placeholder ?? DATE_PLACEHOLDER}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={invalid ? true : rest["aria-invalid"]}
        title={invalid ?? rest.title}
        className={`w-full pr-9 tabular-nums ${input}`.trim()}
        onFocus={(e) => {
          setEditing(true);
          setText(fmtDate(iso));
          onFocus?.(e);
        }}
        onChange={(e) => handleText(e.target.value)}
        onBlur={(e) => {
          finish();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
          onKeyDown?.(e);
        }}
      />
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <span
        className={`absolute inset-y-0 right-0 flex w-9 items-center justify-center ${disabled || readOnly ? "opacity-40" : "cursor-pointer"}`}
        aria-hidden={disabled || readOnly ? true : undefined}
      >
        <CalendarDays size={16} strokeWidth={2} aria-hidden className="text-ink-subtle pointer-events-none" />
        {!disabled && !readOnly && (
          // The browser's own picker, invisible, over the icon: a click opens it; its choice flows back as ISO.
          <input
            type="date"
            tabIndex={-1}
            aria-label="Open calendar"
            value={iso}
            min={min}
            max={max}
            onChange={(e) => {
              setEditing(false);
              commit(e.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </span>
    </span>
  );
});
