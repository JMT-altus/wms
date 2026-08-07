"use client";
import * as React from "react";

/**
 * Interactive 1–5 star picker. Controlled by the caller so the surrounding
 * form owns submission; hovering previews, clicking commits the value.
 */
export function StarRating({
  value,
  onChange,
  size = 26,
  disabled = false,
  label = "Rating",
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
  disabled?: boolean;
  label?: string;
}) {
  const [hover, setHover] = React.useState(0);
  const shown = hover || value;

  return (
    <div
      className="inline-flex items-center gap-1"
      role="radiogroup"
      aria-label={label}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i === 1 ? "" : "s"}`}
          disabled={disabled}
          onMouseEnter={() => !disabled && setHover(i)}
          onClick={() => !disabled && onChange(i)}
          className="rounded transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ lineHeight: 0 }}
        >
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45L2.6 9.45l6.5-.95L12 2.6z"
              fill={i <= shown ? "#f59e0b" : "rgba(15,23,42,0.13)"}
              stroke={i <= shown ? "#d97706" : "transparent"}
              strokeWidth={0.6}
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
