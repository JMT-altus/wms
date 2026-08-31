"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Layers,
  LayoutGrid,
  ListPlus,
  Mic,
  MicOff,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useDictation } from "@/lib/voice/dictation";
import {
  KYC_CATEGORIES,
  type KycCategory,
  type KycListKey,
  type ResolvedKycList,
} from "@/lib/masters/kyc-dropdowns";
import {
  addKycOption,
  adoptKycDefaults,
  bulkAddKycOptions,
  deleteKycOption,
  moveKycOption,
  renameKycOption,
  resetKycList,
} from "@/app/(forms-module)/forms/client-kyc/cust-dropdown/actions";
import { ConfirmDelete } from "@/components/admin/master/data-table";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Client Master DD — the configuration screen for every editable dropdown
 * on the Client KYC form.
 *
 * One card per list, all driven by the same registry the KYC form reads, so a
 * change here is the change the form sees. A list with no saved rows shows its
 * built-in defaults as read-only suggestions until someone adopts them; from
 * then on the rows are real and fully editable.
 */

const CARD = "rounded-section bg-surface-card px-4 py-3.5 flex flex-col";
const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-hairline)",
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
};

export function CustDropdownMaster({ lists }: { lists: ResolvedKycList[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<KycCategory | "All">("All");

  const stats = React.useMemo(
    () => ({
      lists: lists.length,
      options: lists.reduce((n, l) => n + l.options.length, 0),
      categories: KYC_CATEGORIES.length,
      customized: lists.filter((l) => l.customized).length,
    }),
    [lists],
  );

  const needle = q.trim().toLowerCase();
  const visible = React.useMemo(
    () =>
      lists.filter((l) => {
        if (category !== "All" && l.def.category !== category) return false;
        if (!needle) return true;
        // Global search spans the category, the list name and every option.
        return (
          l.def.category.toLowerCase().includes(needle) ||
          l.def.label.toLowerCase().includes(needle) ||
          l.options.some((o) => o.label.toLowerCase().includes(needle))
        );
      }),
    [lists, category, needle],
  );

  /** Every write funnels through here so refresh + errors behave the same. */
  /**
   * What the confirmation dialog is currently asking about.
   *
   * Held here rather than inside each card so there is one dialog on the
   * page at a time, and so deleting an option and resetting a whole list ask
   * in the same voice instead of one styled panel and one browser alert.
   */
  const [confirming, setConfirming] = React.useState<
    | { kind: "option"; listKey: KycListKey; id: string; label: string }
    | { kind: "reset"; listKey: KycListKey; label: string }
    | null
  >(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
        router.refresh();
      } else {
        toast.error(res.error ?? "That didn't work.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p
          className="uppercase font-bold tracking-[0.14em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          Client KYC · Configuration
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Same heading as every other Client KYC screen — Client Bank
              Master, Client Address Book and the rest all render theirs
              through DataTable's title. This one is hand-written because the
              page is not a table, so the style is matched here rather than
              inherited: ink-strong rather than the accent, and the same
              clamp so it scales with the viewport instead of sitting at a
              fixed 24px while its neighbours grow. */}
          <h1
            className="mt-1 flex-1 min-w-0 font-bold text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontSize: "clamp(19px, 1.9vw, 26px)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            Client Master DD
          </h1>
          <FullscreenToggle />
        </div>
        {/* One line on a desktop width: the 62ch cap that used to be here
            wrapped it to three even on a wide screen, which made the header
            taller than the first list below it. Tightened wording keeps it
            inside a laptop width rather than relying on the viewport being
            generous.

            Still wraps below md — forcing nowrap on a phone would push the
            page sideways, and a subtitle is not worth a horizontal scrollbar. */}
        <p
          className="mt-1.5 text-ink-muted whitespace-nowrap max-md:whitespace-normal"
          style={{ fontSize: 13.5 }}
        >
          Every editable dropdown on the Client KYC form — add, rename, reorder or remove
          options, bulk-paste, or reset a list to its defaults. Changes appear instantly.
        </p>
      </header>

      <div
        className="grid gap-3 grid-cols-2 lg:grid-cols-4 rounded-section px-3 py-3"
        style={{ background: KYC_ACCENT_SOFT }}
      >
        <Stat icon={LayoutGrid} value={stats.lists} label="Dropdown Lists" />
        <Stat icon={Layers} value={stats.options} label="Total Options" />
        <Stat icon={SlidersHorizontal} value={stats.categories} label="Categories" />
        <Stat icon={CircleCheck} value={stats.customized} label="Customized" tone="green" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-2 rounded-lg px-3 h-10 bg-surface-card flex-1 min-w-[240px]"
          style={{ border: "1px solid var(--color-hairline)", maxWidth: 600 }}
        >
          <Search size={15} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every list and option..."
            className="bg-transparent outline-none text-[14px] w-full min-w-0 text-ink-strong"
          />
        </span>

        <CategoryPill
          label="All"
          count={lists.length}
          showCount={false}
          active={category === "All"}
          onClick={() => setCategory("All")}
        />
        {KYC_CATEGORIES.map((c) => (
          <CategoryPill
            key={c}
            label={c}
            count={lists.filter((l) => l.def.category === c).length}
            active={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      {KYC_CATEGORIES.map((c) => {
        const inCategory = visible.filter((l) => l.def.category === c);
        if (inCategory.length === 0) return null;
        return (
          <section key={c}>
            <div className="flex items-center gap-3 mb-3">
              <h2
                className="shrink-0 uppercase font-bold tracking-[0.12em]"
                style={{ fontSize: 11, color: KYC_ACCENT }}
              >
                {c}
              </h2>
              <span className="flex-1 h-px" style={{ background: "var(--color-hairline)" }} />
              <span
                className="shrink-0 rounded-pill px-2 py-0.5 uppercase font-bold tracking-[0.08em]"
                style={{ fontSize: 9.5, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
              >
                {inCategory.length} {inCategory.length === 1 ? "list" : "lists"}
              </span>
            </div>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 items-start">
              {inCategory.map((l) => (
                <ListCard
                  key={l.def.key}
                  list={l}
                  pending={pending}
                  run={run}
                  onDeleteOption={(id, label) =>
                    setConfirming({ kind: "option", listKey: l.def.key, id, label })
                  }
                  onResetList={() =>
                    setConfirming({ kind: "reset", listKey: l.def.key, label: l.def.label })
                  }
                />
              ))}
            </div>
          </section>
        );
      })}

      {visible.length === 0 && (
        <p className="text-ink-subtle text-center py-10" style={{ fontSize: 13.5 }}>
          Nothing matches “{q}”.
        </p>
      )}

      {confirming && (
        <ConfirmDelete
          count={1}
          noun="option"
          busy={pending}
          accent={KYC_ACCENT}
          subject={confirming.label}
          heading={
            confirming.kind === "option"
              ? "Are you sure you want to permanently delete this?"
              : `Reset ${confirming.label} to its default options?`
          }
          body={
            confirming.kind === "option"
              ? "This cannot be restored later. Clients already saved with it keep the value they hold."
              : "Every option you added to this list is removed. Clients already saved with one keep the value they hold."
          }
          confirmLabel={confirming.kind === "option" ? "Delete permanently" : "Reset to defaults"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const c = confirming;
            setConfirming(null);
            if (c.kind === "option") {
              run(() => deleteKycOption(c.listKey, c.id), `"${c.label}" removed.`);
            } else {
              run(() => resetKycList(c.listKey), `${c.label} reset to defaults.`);
            }
          }}
        />
      )}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Layers;
  value: number;
  label: string;
  tone?: "green";
}) {
  const color = tone === "green" ? "var(--color-green-deep)" : KYC_ACCENT;
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg bg-surface-card px-3 py-2"
      style={{ border: "1px solid var(--color-hairline)" }}
    >
      <span
        className="shrink-0 grid place-items-center rounded-lg"
        style={{ width: 28, height: 28, background: "var(--color-surface-soft)" }}
      >
        <Icon size={15} strokeWidth={2.2} style={{ color }} />
      </span>
      <span className="min-w-0">
        <span className="block font-bold tabular-nums" style={{ fontSize: 19, color, lineHeight: 1.1 }}>
          {value}
        </span>
        <span
          className="block uppercase font-bold tracking-[0.08em] text-ink-subtle truncate"
          style={{ fontSize: 9.5 }}
        >
          {label}
        </span>
      </span>
    </div>
  );
}

function CategoryPill({
  label,
  count,
  active,
  onClick,
  showCount = true,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  showCount?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-pill px-3 h-10 font-semibold whitespace-nowrap"
      style={
        active
          ? { fontSize: 13, background: KYC_ACCENT, color: "#fff" }
          : {
              fontSize: 13,
              background: "var(--color-surface-card)",
              color: "var(--color-ink-soft)",
              border: "1px solid var(--color-hairline)",
            }
      }
    >
      {label}
      {showCount && (
        <span
          className="inline-flex rounded-pill px-1.5 font-bold tabular-nums"
          style={{
            fontSize: 10.5,
            background: active ? "rgba(255,255,255,0.22)" : "var(--color-surface-soft)",
            color: active ? "#fff" : "var(--color-ink-muted)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ListCard({
  list,
  pending,
  run,
  onDeleteOption,
  onResetList,
}: {
  list: ResolvedKycList;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => void;
  /** Asks for confirmation; the page owns the dialog and the deleting. */
  onDeleteOption: (id: string, label: string) => void;
  onResetList: () => void;
}) {
  const { def, options, customized } = list;
  const [cardQ, setCardQ] = React.useState("");
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkText, setBulkText] = React.useState("");

  /**
   * How many options the paste would actually add.
   *
   * Mirrors `bulkAddKycOptions` exactly — split on newlines, trim, drop
   * blanks, drop anything over 200 characters, drop case-insensitive repeats,
   * and drop what the list already holds. Counting raw lines instead would
   * promise twelve and add eight the moment someone re-pastes a column that
   * overlaps what is already there, which is the common case rather than the
   * rare one.
   */
  /**
   * Commit the paste. Held in a ref as well, because the dictation session is
   * created once and would otherwise call whichever version of this existed
   * when the microphone was switched on — with an empty box.
   */
  function submitBulk() {
    if (bulkCountRef.current === 0) return;
    const text = bulkTextRef.current;
    setBulkOpen(false);
    setBulkText("");
    run(() => bulkAddKycOptions(def.key, text), "Options added.");
  }

  const bulkCount = React.useMemo(() => {
    const seen = new Set(options.map((o) => o.label.trim().toLowerCase()));
    let n = 0;
    for (const line of bulkText.split(/\r?\n/)) {
      const v = line.trim();
      if (!v || v.length > 200) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      n += 1;
    }
    return n;
  }, [bulkText, options]);

  /* ── Dictation ─────────────────────────────────────────────────────────── */

  const bulkTextRef = React.useRef(bulkText);
  const bulkCountRef = React.useRef(bulkCount);
  React.useEffect(() => {
    bulkTextRef.current = bulkText;
    bulkCountRef.current = bulkCount;
  });

  const submitRef = React.useRef(submitBulk);
  React.useEffect(() => {
    submitRef.current = submitBulk;
  });

  /**
   * Speak the values instead of typing them.
   *
   * "Purchase Manager" … "next" … "Accounts Head" … "add".
   *
   * A spoken value goes onto the line being written; "next" starts a new one;
   * "add" commits the lot. Appending is done through the functional form of
   * setState because the recogniser fires outside React's event flow, and
   * closing over `bulkText` would drop every value after the first.
   */
  const dictation = useDictation({
    onValue: (text) =>
      setBulkText((prev) => {
        // Continue the line in progress rather than starting a new one, so a
        // value that comes back in two fragments stays one option.
        const sep = prev === "" || prev.endsWith("\n") ? "" : " ";
        return prev + sep + text;
      }),
    onCommand: (command) => {
      if (command === "next") {
        // A trailing newline already means "ready for the next value" — a
        // second "next" should not leave a blank line behind.
        setBulkText((prev) => (prev === "" || prev.endsWith("\n") ? prev : prev + "\n"));
        return;
      }
      submitRef.current();
    },
  });

  // The microphone belongs to the open panel. Closing it — by Cancel, by Add
  // all, or by the panel collapsing — must not leave the tab recording.
  React.useEffect(() => {
    if (!bulkOpen && dictation.listening) dictation.stop();
  }, [bulkOpen, dictation]);

  React.useEffect(() => {
    if (dictation.error) toast.error(dictation.error);
  }, [dictation.error]);
  const [draft, setDraft] = React.useState("");

  const needle = cardQ.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  function add() {
    const clean = draft.trim();
    if (!clean) return;
    setDraft("");
    run(() => addKycOption(def.key, clean), `"${clean}" added.`);
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <div className="flex items-start gap-2 mb-1.5">
        <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <strong className="text-ink-strong" style={{ fontSize: 14.5 }}>
            {def.label}
          </strong>
          <span
            className="inline-flex rounded-pill px-1.5 py-0.5 font-bold tabular-nums"
            style={{ fontSize: 10, background: KYC_ACCENT_SOFT, color: KYC_ACCENT }}
          >
            {options.length}
          </span>
          <span
            className="inline-flex rounded-pill px-1.5 py-0.5 font-bold uppercase tracking-[0.06em]"
            style={
              customized
                ? {
                    fontSize: 9,
                    background: "color-mix(in srgb, var(--color-green) 12%, transparent)",
                    color: "var(--color-green-deep)",
                  }
                : { fontSize: 9, background: "var(--color-surface-soft)", color: "var(--color-ink-subtle)" }
            }
          >
            {customized ? "Custom" : "Default"}
          </span>
        </span>

        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 h-7 font-semibold text-ink-soft bg-surface-card"
          style={{ fontSize: 11.5, border: "1px solid var(--color-hairline)" }}
        >
          <ListPlus size={12} strokeWidth={2.4} />
          Bulk add
        </button>

        {customized ? (
          // Clearing saved rows returns the list to its built-in defaults.
          def.storage === "designations" ? null : (
            <button
              type="button"
              title="Reset to defaults"
              disabled={pending}
              onClick={() => {
                onResetList();
              }}
              className="shrink-0 grid place-items-center rounded-lg size-7 text-ink-subtle hover:text-ink-strong"
              style={{ border: "1px solid var(--color-hairline)" }}
            >
              <Trash2 size={12.5} strokeWidth={2.2} />
            </button>
          )
        ) : (
          <button
            type="button"
            title="Save these defaults so they can be edited"
            disabled={pending}
            onClick={() => run(() => adoptKycDefaults(def.key), `${def.label} defaults saved.`)}
            className="shrink-0 grid place-items-center rounded-lg size-7 text-ink-subtle hover:text-ink-strong"
            style={{ border: "1px solid var(--color-hairline)" }}
          >
            <RotateCcw size={12.5} strokeWidth={2.2} />
          </button>
        )}
      </div>

      <p className="text-ink-subtle mb-2.5" style={{ fontSize: 11.5 }}>
        {def.description}
      </p>

      {bulkOpen && (
        <div
          className="mb-2.5 rounded-lg p-3"
          style={{ border: `1px solid ${KYC_ACCENT}`, background: "var(--color-surface-soft)" }}
        >
          {/* Says what the box wants before it is typed into. The placeholder
              alone could not: it disappears at the first keystroke, which is
              exactly when someone pasting a column from a spreadsheet is
              wondering whether the format was right. */}
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="uppercase font-bold tracking-[0.08em] text-ink-subtle"
              style={{ fontSize: 10.5 }}
            >
              Paste many — one per line
            </span>
            {/* Offered only where the browser can actually do it: Chrome and
                Edge have SpeechRecognition, Firefox does not. A mic that did
                nothing would be worse than no mic. */}
            {dictation.supported && (
              <button
                type="button"
                onClick={dictation.toggle}
                title={
                  dictation.listening
                    ? "Stop dictating"
                    : "Dictate: say a value, say “next” for the next line, “add” to finish"
                }
                aria-pressed={dictation.listening}
                className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 h-7 font-semibold"
                style={
                  dictation.listening
                    ? { fontSize: 11.5, background: KYC_ACCENT, color: "#fff" }
                    : {
                        fontSize: 11.5,
                        border: "1px solid var(--color-hairline)",
                        background: "var(--color-surface-card)",
                        color: "var(--color-ink-soft)",
                      }
                }
              >
                {dictation.listening ? (
                  <>
                    <MicOff size={12} strokeWidth={2.5} />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic size={12} strokeWidth={2.5} />
                    Speak
                  </>
                )}
              </button>
            )}
          </div>
          {dictation.listening && (
            <p className="mb-1.5 text-ink-subtle" style={{ fontSize: 11 }}>
              Listening — say a value, then <strong className="text-ink-soft">next</strong> for
              the following line, or <strong className="text-ink-soft">add</strong> to finish.
            </p>
          )}
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            placeholder={"Value one\nValue two\nValue three"}
            className="w-full rounded-md px-2.5 py-2 bg-surface-card outline-none text-[12.5px] text-ink-strong resize-y"
            style={{ border: "1px solid var(--color-hairline)" }}
          />
          <div className="flex items-center gap-2 mt-2">
            {/* Add all leads, and carries the same icon as the Bulk add button
                that opened this — one action, begun and finished. */}
            <button
              type="button"
              disabled={pending || bulkCount === 0}
              onClick={submitBulk}
              className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 font-bold text-white disabled:opacity-50"
              style={{ fontSize: 12, background: KYC_ACCENT }}
            >
              <ListPlus size={13} strokeWidth={2.5} />
              Add all
            </button>
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                setBulkText("");
              }}
              className="rounded-md px-3 h-8 font-semibold text-ink-soft bg-surface-card"
              style={{ fontSize: 12, border: "1px solid var(--color-hairline)" }}
            >
              Cancel
            </button>
            {/* Counted the same way the server splits the paste, so the number
                is what will actually be added — not how many lines were typed.
                Blank lines and repeats are dropped, and seeing "8 values" from
                ten lines is the cheapest possible warning that two were. */}
            <span className="text-ink-subtle" style={{ fontSize: 12 }}>
              {bulkCount} {bulkCount === 1 ? "value" : "values"}
            </span>
          </div>
        </div>
      )}

      {def.searchable && (
        <span
          className="inline-flex items-center gap-2 rounded-lg px-2.5 h-8 mb-2 bg-surface-card"
          style={{ border: "1px solid var(--color-hairline)" }}
        >
          <Search size={13} strokeWidth={2.2} className="text-ink-subtle shrink-0" />
          <input
            value={cardQ}
            onChange={(e) => setCardQ(e.target.value)}
            placeholder={`Search ${def.label.toLowerCase()}...`}
            className="bg-transparent outline-none text-[12.5px] w-full min-w-0 text-ink-strong"
          />
        </span>
      )}

      {!customized && (
        <p className="flex items-start gap-1 mb-1.5 text-ink-subtle" style={{ fontSize: 11 }}>
          <Pencil size={10} strokeWidth={2.4} className="mt-[3px] shrink-0" />
          <span>
            Suggested defaults (not saved yet -{" "}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => adoptKycDefaults(def.key), `${def.label} defaults saved.`)}
              className="font-semibold underline underline-offset-2"
              style={{ color: KYC_ACCENT }}
            >
              use defaults
            </button>{" "}
            or start your own):
          </span>
        </p>
      )}

      {/* Capped height with its own scrollbar — Bank Name and Currency run to
          hundreds of rows and would otherwise make one card page-length. */}
      <div className="flex-1 overflow-y-auto pr-1" style={{ maxHeight: 260 }}>
        {shown.map((o, i) => (
          <OptionRow
            key={o.id}
            listKey={def.key}
            id={o.id}
            label={o.label}
            editable={customized}
            first={i === 0}
            last={i === shown.length - 1}
            pending={pending}
            run={run}
            onDelete={() => onDeleteOption(o.id, o.label)}
          />
        ))}
        {shown.length === 0 && (
          <p className="text-ink-subtle py-2" style={{ fontSize: 11.5 }}>
            {needle ? "No match." : "No options yet."}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--color-hairline)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add an option..."
          maxLength={200}
          className="flex-1 min-w-0 rounded-lg px-2.5 h-8 bg-surface-card outline-none text-[12.5px] text-ink-strong"
          style={{ border: "1px solid var(--color-hairline)" }}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !draft.trim()}
          title="Add option"
          className="shrink-0 grid place-items-center rounded-lg size-8 text-white disabled:opacity-45"
          style={{ background: KYC_ACCENT }}
        >
          <Plus size={14} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

/**
 * One option. Saved rows are editable in place; unsaved defaults render
 * read-only, since there is no row to rename, move or delete yet.
 */
function OptionRow({
  listKey,
  id,
  label,
  editable,
  first,
  last,
  pending,
  run,
  onDelete,
}: {
  listKey: KycListKey;
  id: string;
  label: string;
  editable: boolean;
  first: boolean;
  last: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => void;
  /** Opens the page's confirmation dialog. Deleting happens there. */
  onDelete: () => void;
}) {
  const [value, setValue] = React.useState(label);

  // Adopt the server's label when it changes under us (after a rename, or a
  // reorder that reuses this row). Adjusted during render rather than in an
  // effect — React re-runs immediately with the corrected value, so the stale
  // one never paints. Same pattern as the shared DataTable's page snap-back.
  const [lastLabel, setLastLabel] = React.useState(label);
  if (label !== lastLabel) {
    setLastLabel(label);
    setValue(label);
  }

  const dirty = editable && value.trim() !== label && value.trim().length > 0;

  if (!editable) {
    return (
      <div
        className="rounded-lg px-2.5 py-1.5 mb-1 text-ink-muted"
        style={{ fontSize: 12.5, border: "1px solid var(--color-hairline)" }}
      >
        {label}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="shrink-0 flex flex-col">
        <button
          type="button"
          title="Move up"
          disabled={pending || first}
          onClick={() => run(() => moveKycOption(listKey, id, "up"))}
          className="grid place-items-center text-ink-subtle hover:text-ink-strong disabled:opacity-25"
          style={{ height: 11 }}
        >
          <ChevronUp size={12} strokeWidth={2.6} />
        </button>
        <button
          type="button"
          title="Move down"
          disabled={pending || last}
          onClick={() => run(() => moveKycOption(listKey, id, "down"))}
          className="grid place-items-center text-ink-subtle hover:text-ink-strong disabled:opacity-25"
          style={{ height: 11 }}
        >
          <ChevronDown size={12} strokeWidth={2.6} />
        </button>
      </span>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) {
            e.preventDefault();
            run(() => renameKycOption(listKey, id, value.trim()), "Renamed.");
          }
          if (e.key === "Escape") setValue(label);
        }}
        // Committed on blur as well as Enter, so clicking away doesn't quietly
        // discard a rename the user has already typed.
        onBlur={() => {
          if (dirty) run(() => renameKycOption(listKey, id, value.trim()));
        }}
        maxLength={200}
        className="flex-1 min-w-0 rounded-lg px-2.5 h-8 bg-surface-card outline-none text-[12.5px] font-semibold text-ink-strong"
        style={{ border: `1px solid ${dirty ? KYC_ACCENT : "var(--color-hairline)"}` }}
      />

      {dirty && (
        <button
          type="button"
          title="Save"
          onClick={() => run(() => renameKycOption(listKey, id, value.trim()), "Renamed.")}
          className="shrink-0 grid place-items-center rounded-lg size-7 text-white"
          style={{ background: KYC_ACCENT }}
        >
          <Check size={12} strokeWidth={3} />
        </button>
      )}

      <button
        type="button"
        title="Remove"
        disabled={pending}
        // Asks first. Removing an option is not undoable — the option is
        // gone from every future form, and only a re-typed duplicate brings
        // it back.
        onClick={onDelete}
        className="shrink-0 grid place-items-center rounded-lg size-7 text-ink-subtle hover:text-ink-strong disabled:opacity-45"
        style={{ border: "1px solid var(--color-hairline)" }}
      >
        <X size={12} strokeWidth={2.6} />
      </button>
    </div>
  );
}
