import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The login mosaic's tile library — a Canva-style wall of distinct "posters",
 * all on-brand for JMT Drive Solutions / WMS. Hand-built SVG/CSS tiles that
 * evoke the app itself: Kanban boards, task lists, KPI cards, charts,
 * attendance grids, payslips, and the JMT wordmark. Pure markup (no external
 * image generation) so the wall ships as light optimized tiles.
 *
 * `POSTER_TILES` is consumed by `login-mosaic.tsx`, which distributes them into
 * drifting columns. Each entry carries a base `h` (px) so the columns build a
 * varied masonry rhythm.
 */

const TEAL = "#0A6CFF";
const TEAL_DEEP = "#0751BE";
const TEAL_LIGHT = "#4C9AFF";
const INK = "#0F1512";
const PAPER = "#F1F5F4";
const GREEN = "#16A34A";
const AMBER = "#F59E0B";
const BLUE = "#3B82F6";

const DISPLAY = "var(--font-display), Georgia, serif";
const SANS = "var(--font-sans), system-ui, sans-serif";
const MONO = "var(--font-mono-display), ui-monospace, monospace";

function Tile({
  h,
  bg,
  children,
  pad = 18,
}: {
  h: number;
  bg: string;
  children: ReactNode;
  pad?: number;
}) {
  return (
    <div
      style={{
        height: h,
        background: bg,
        borderRadius: 14,
        padding: pad,
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 10px 30px -14px rgba(0,0,0,0.5)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {children}
    </div>
  );
}

/** The JMT Drive Solutions logo mark (transparent PNG), sized to taste. */
function Mark({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{
        objectFit: "contain",
        filter: glow ? "drop-shadow(0 4px 14px rgba(10,108,255,0.45))" : undefined,
      }}
    />
  );
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: "0.04em",
        background: `color-mix(in srgb, ${tone} 16%, transparent)`,
        color: tone,
        fontFamily: SANS,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone }} />
      {children}
    </span>
  );
}

// ── Slogan / type posters ────────────────────────────────────────────────

function SloganBrand() {
  return (
    <Tile h={300} bg={`linear-gradient(160deg, #10201c, ${INK})`}>
      <Mark size={46} />
      <div style={{ marginTop: 18, fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 30, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
        WORK
        <br />
        <span style={{ color: TEAL_LIGHT }}>MANAGED.</span>
      </div>
      <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.22em", color: "rgba(255,255,255,0.5)" }}>
        SYSTEM · DRIVEN · OPS
      </div>
    </Tile>
  );
}

function SloganClarity() {
  return (
    <Tile h={360} bg={`linear-gradient(150deg, ${TEAL}, ${TEAL_DEEP})`}>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 27, lineHeight: 1.06, letterSpacing: "-0.01em" }}>
        ONE TEAM.<br />ONE BOARD.
      </div>
      <div style={{ marginTop: 10, fontFamily: SANS, fontWeight: 800, color: "rgba(255,255,255,0.8)", fontSize: 16, lineHeight: 1.15 }}>
        Every task, owner, and deadline in one place.
      </div>
      <div style={{ position: "absolute", right: -20, bottom: -24, opacity: 0.18 }}>
        <Mark size={150} glow={false} />
      </div>
      <div style={{ position: "absolute", left: 18, bottom: 16, fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", color: "rgba(255,255,255,0.7)" }}>
        JMT DRIVE SOLUTIONS
      </div>
    </Tile>
  );
}

function SloganAccountable() {
  return (
    <Tile h={230} bg="linear-gradient(160deg,#14231f,#0a110f)">
      <div style={{ fontFamily: DISPLAY, fontStyle: "italic", color: "#fff", fontSize: 30, lineHeight: 1.05 }}>
        Accountability,<br />by default
      </div>
      <div style={{ marginTop: 12, height: 3, width: 54, background: TEAL, borderRadius: 2 }} />
      <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 12.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.45 }}>
        Status, owner, and due date on every task.
      </div>
    </Tile>
  );
}

function SloganDelegate() {
  return (
    <Tile h={210} bg={PAPER}>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: INK, fontSize: 30, lineHeight: 1.0, letterSpacing: "-0.02em" }}>
        ASSIGN.
        <br />
        <span style={{ color: TEAL }}>TRACK. DONE.</span>
      </div>
      <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 12, color: "#4b5b57", fontWeight: 600 }}>
        Transfer ownership, not just tasks.
      </div>
    </Tile>
  );
}

function SloganOwnDay() {
  return (
    <Tile h={250} bg="linear-gradient(150deg,#0c2620,#08120f)">
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.24em", color: TEAL_LIGHT }}>EVERY · MORNING</div>
      <div style={{ marginTop: 14, fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 33, lineHeight: 0.98, letterSpacing: "-0.02em" }}>
        OWN<br />YOUR<br />DAY.
      </div>
    </Tile>
  );
}

function SloganHours() {
  return (
    <Tile h={250} bg={PAPER}>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: INK, fontSize: 23, lineHeight: 1.05 }}>
        SAVE <span style={{ color: TEAL }}>2–3 HRS</span> DAILY
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 9 }}>
        {["Top 3 priorities", "No reverse delegation", "Daily compliance"].map((t) => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>
            <span style={{ fontFamily: SANS, fontSize: 12.5, color: "#3d4b47", fontWeight: 600 }}>{t}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function StatGrowth() {
  return (
    <Tile h={200} bg={`linear-gradient(150deg, ${TEAL_LIGHT}, ${TEAL_DEEP})`}>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 72, lineHeight: 0.9, letterSpacing: "-0.04em" }}>2×</div>
      <div style={{ marginTop: 6, fontFamily: SANS, fontWeight: 800, color: "rgba(255,255,255,0.9)", fontSize: 14 }}>throughput in 90 days</div>
    </Tile>
  );
}

// ── App-UI mockup tiles ──────────────────────────────────────────────────

function KanbanMock() {
  const cols: [string, string, number][] = [
    ["TO DO", "#64748b", 3],
    ["DOING", AMBER, 2],
    ["DONE", GREEN, 2],
  ];
  return (
    <Tile h={250} bg="#0f1512" pad={14}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>KANBAN</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {cols.map(([label, tone, n]) => (
          <div key={label} style={{ display: "grid", gap: 6 }}>
            <div style={{ fontFamily: SANS, fontSize: 8.5, fontWeight: 800, color: tone, letterSpacing: "0.06em" }}>{label}</div>
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} style={{ height: 30, borderRadius: 6, background: "rgba(255,255,255,0.06)", borderLeft: `3px solid ${tone}`, padding: "5px 6px" }}>
                <div style={{ height: 4, width: "78%", borderRadius: 3, background: "rgba(255,255,255,0.22)" }} />
                <div style={{ height: 4, width: "50%", borderRadius: 3, background: "rgba(255,255,255,0.12)", marginTop: 4 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Tile>
  );
}

function TaskListMock() {
  const rows: [string, string, string][] = [
    ["AS", GREEN, "Done"],
    ["MV", AMBER, "Pending"],
    ["HV", TEAL, "Critical"],
    ["DK", BLUE, "Review"],
  ];
  return (
    <Tile h={235} bg={PAPER} pad={14}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 900, color: INK, marginBottom: 10, letterSpacing: "0.02em" }}>TASKS · TODAY</div>
      <div style={{ display: "grid", gap: 9 }}>
        {rows.map(([ini, tone, label], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 24, height: 24, borderRadius: 999, background: INK, color: "#fff", fontFamily: SANS, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{ini}</span>
            <span style={{ flex: 1, display: "grid", gap: 4 }}>
              <span style={{ height: 5, width: "70%", borderRadius: 3, background: "#cdd8d5" }} />
              <span style={{ height: 4, width: "44%", borderRadius: 3, background: "#dee6e3" }} />
            </span>
            <Pill tone={tone}>{label}</Pill>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function KpiCluster() {
  const kpis: [string, string, string][] = [
    ["286", "PENDING", AMBER],
    ["77", "DONE", GREEN],
    ["60", "CRITICAL", TEAL],
    ["15", "URGENT", "#f97316"],
  ];
  return (
    <Tile h={210} bg="#0e1310" pad={14}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        {kpis.map(([n, l, tone]) => (
          <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "10px 11px", borderTop: `3px solid ${tone}` }}>
            <div style={{ fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 26, lineHeight: 1, letterSpacing: "-0.03em" }}>{n}</div>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.14em", color: tone, marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function DonutTile() {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <Tile h={210} bg={PAPER} pad={16}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 900, color: INK, marginBottom: 8 }}>ON TRACK</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg width={92} height={92} viewBox="0 0 92 92">
          <circle cx="46" cy="46" r={r} fill="none" stroke="#dce6e3" strokeWidth="13" />
          <circle cx="46" cy="46" r={r} fill="none" stroke={TEAL} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${c * 0.72} ${c}`} transform="rotate(-90 46 46)" />
          <text x="46" y="51" textAnchor="middle" fontFamily={SANS} fontWeight="900" fontSize="19" fill={INK}>72%</text>
        </svg>
        <div style={{ display: "grid", gap: 8 }}>
          <Pill tone={TEAL}>On track</Pill>
          <Pill tone={AMBER}>At risk</Pill>
          <Pill tone={GREEN}>Approved</Pill>
        </div>
      </div>
    </Tile>
  );
}

function BarsTile() {
  const bars = [40, 62, 48, 80, 58, 92, 70];
  return (
    <Tile h={200} bg="linear-gradient(160deg,#13201c,#0a110f)" pad={14}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>WEEKLY VELOCITY</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 110 }}>
        {bars.map((b, i) => (
          <div key={i} style={{ flex: 1, height: `${b}%`, borderRadius: "4px 4px 0 0", background: i === 5 ? TEAL : "rgba(59,180,162,0.45)" }} />
        ))}
      </div>
    </Tile>
  );
}

function AttendanceTile() {
  return (
    <Tile h={235} bg={PAPER} pad={14}>
      <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 900, color: INK, marginBottom: 10 }}>ATTENDANCE</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>
        {Array.from({ length: 28 }).map((_, i) => {
          const on = i % 6 !== 4 && i % 7 !== 6;
          return <span key={i} style={{ aspectRatio: "1", borderRadius: 4, background: on ? "color-mix(in srgb, #16A34A 80%, white)" : "#dbe6e2" }} />;
        })}
      </div>
      <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 11.5, color: "#3f4d49", fontWeight: 700 }}>
        Checked in <span style={{ color: GREEN }}>10:34 am</span>
      </div>
    </Tile>
  );
}

function PayslipTile() {
  return (
    <Tile h={205} bg="linear-gradient(160deg,#111a17,#0a110f)" pad={16}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.18em", color: "rgba(255,255,255,0.45)" }}>PAYSLIP · JUN</div>
      <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Net payable</div>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: "#fff", fontSize: 34, letterSpacing: "-0.02em" }}>₹1,24,800</div>
      <div style={{ marginTop: 12, height: 1, background: "rgba(255,255,255,0.1)" }} />
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontFamily: SANS, fontSize: 10.5, color: "rgba(255,255,255,0.55)" }}>
        <span>Payable days 26</span>
        <Pill tone={GREEN}>Disbursed</Pill>
      </div>
    </Tile>
  );
}

function WordmarkTile() {
  return (
    <Tile h={150} bg={PAPER}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: "100%" }}>
        <Mark size={38} glow={false} />
        <div style={{ fontFamily: MONO, fontWeight: 800, color: INK, fontSize: 17, letterSpacing: "0.16em" }}>JMT<br />DRIVE</div>
      </div>
    </Tile>
  );
}

function BrandMarkTile() {
  return (
    <Tile h={190} bg="radial-gradient(120% 90% at 50% 20%, #0f2a24, #071310)">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Mark size={92} />
      </div>
    </Tile>
  );
}

function QuoteTile() {
  return (
    <Tile h={215} bg={`linear-gradient(155deg, ${TEAL_DEEP}, #072019)`} pad={18}>
      <div style={{ fontFamily: DISPLAY, fontStyle: "italic", color: "#fff", fontSize: 21, lineHeight: 1.3 }}>
        “Scale ethically &amp; sustainably — in a time-bound manner.”
      </div>
      <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: "rgba(255,255,255,0.7)" }}>JMT DRIVE SOLUTIONS</div>
    </Tile>
  );
}

function ChecklistTile() {
  return (
    <Tile h={245} bg={PAPER} pad={15}>
      <div style={{ fontFamily: SANS, fontWeight: 900, color: TEAL, fontSize: 13, letterSpacing: "0.02em" }}>HOW IT WORKS</div>
      <div style={{ marginTop: 8, fontFamily: SANS, fontWeight: 900, color: INK, fontSize: 15, lineHeight: 1.15 }}>Effective Delegation</div>
      <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
        {["Capture all work", "Define ownership", "Daily compliance", "No responsibility leakage"].map((t) => (
          <div key={t} style={{ display: "flex", gap: 7, alignItems: "center", fontFamily: SANS, fontSize: 11.5, color: "#4b5b57", fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: TEAL }} />
            {t}
          </div>
        ))}
      </div>
    </Tile>
  );
}

export interface PosterTile {
  id: string;
  el: ReactNode;
}

/** The full deck, deliberately ordered so neighbours differ in tone + type. */
export const POSTER_TILES: PosterTile[] = [
  { id: "brand", el: <SloganBrand /> },
  { id: "kanban", el: <KanbanMock /> },
  { id: "clarity", el: <SloganClarity /> },
  { id: "tasks", el: <TaskListMock /> },
  { id: "kpi", el: <KpiCluster /> },
  { id: "accountable", el: <SloganAccountable /> },
  { id: "donut", el: <DonutTile /> },
  { id: "delegate", el: <SloganDelegate /> },
  { id: "bars", el: <BarsTile /> },
  { id: "attendance", el: <AttendanceTile /> },
  { id: "ownday", el: <SloganOwnDay /> },
  { id: "payslip", el: <PayslipTile /> },
  { id: "brandmark", el: <BrandMarkTile /> },
  { id: "hours", el: <SloganHours /> },
  { id: "quote", el: <QuoteTile /> },
  { id: "growth", el: <StatGrowth /> },
  { id: "checklist", el: <ChecklistTile /> },
  { id: "wordmark", el: <WordmarkTile /> },
];
