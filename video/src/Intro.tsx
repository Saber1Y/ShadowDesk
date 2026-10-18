import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Backdrop, C, CheckIcon, CrossIcon, Label, LockIcon, Mark, Panel, Pill, easeInOut, easeOut, fmt, mono, sans, useLayout, usePop, useProgress } from "./brand";
import manifest from "../public/voiceover/manifest.json";

/**
 * ShadowDesk motion intro at 30 fps. Scene lengths are worked out from the voiceover itself
 * (public/voiceover/manifest.json): each scene opens, its line starts LEAD frames later, and the
 * next scene follows TAIL frames after the line ends, so the narration stays compact. Each scene
 * also has a minimum length so its animation always has room to play.
 *
 * The figures are the LocalNet demo round's (docs/demo-walkthrough/5-institutional-settlement.png).
 */
export const FPS = 30;
const LEAD = 8;
const TAIL = 6;
/** How long the logo holds after the last line. */
const HOLD = 30;

const ORDER = [
  { name: "order", vo: "intro-01", min: 80 },
  { name: "mandate", vo: "intro-02", min: 140 },
  { name: "cap", vo: "intro-03", min: 120 },
  { name: "sealed", vo: "intro-04", min: 110 },
  { name: "award", vo: "intro-05", min: 110 },
  { name: "settle", vo: "intro-06", min: 120 },
  { name: "receipt", vo: "intro-07", min: 90 },
  { name: "logo", vo: "intro-08", min: 0 },
] as const;

type SceneName = (typeof ORDER)[number]["name"];
type Timing = { from: number; to: number; vo: { id: string; at: number } };

function timeline(): { scenes: Record<SceneName, Timing>; duration: number } {
  const scenes = {} as Record<SceneName, Timing>;
  let t = 0;
  for (const s of ORDER) {
    const line = (manifest as Record<string, { seconds: number }>)[s.vo];
    if (!line) throw new Error(`voiceover line ${s.vo} is missing; run npm run voiceover`);
    const vo = Math.ceil(line.seconds * FPS);
    const length = Math.max(s.min, LEAD + vo + (s.name === "logo" ? HOLD : TAIL));
    scenes[s.name] = { from: t, to: t + length, vo: { id: s.vo, at: t + LEAD } };
    t += length;
  }
  return { scenes, duration: t };
}

const { scenes: SCENES, duration } = timeline();
export const DURATION = duration;

const DEAL = "DEAL-RFQ-DEMO-1789858005273";

function Center({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...style }}>{children}</AbsoluteFill>;
}

/** The step marker in the corner, in the style of the dashboard's "FABRIC LIVE" eyebrow. */
function Kicker({ step, title }: { step: string; title: string }) {
  const { u, wide } = useLayout();
  const pop = usePop(2);
  return (
    <div style={{ position: "absolute", top: (wide ? 70 : 60) * u, ...(wide ? { left: 90 * u } : { left: 0, right: 0, textAlign: "center" }), ...pop.style }}>
      <Label color={C.primary} style={{ fontSize: 28 * u, letterSpacing: "0.3em" }}>
        {step}
      </Label>
      <Label style={{ fontSize: 28 * u, letterSpacing: "0.3em", marginLeft: 18 * u }}>{title}</Label>
    </div>
  );
}

/** Hex "ciphertext" that re-rolls every few frames: what a non-stakeholder would see of a price. */
function Cipher({ length, seed, style }: { length: number; seed: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const tick = Math.floor(frame / 3);
  const chars = Array.from({ length }, (_, i) => {
    if (i === 4) return "·";
    const n = Math.abs(Math.sin((i + 1) * 12.9898 + (tick + seed) * 78.233) * 43758.5453);
    return "0123456789abcdef"[Math.floor((n - Math.floor(n)) * 16)];
  });
  return <span style={{ fontFamily: mono, whiteSpace: "nowrap", ...style }}>{chars.join("")}</span>;
}

/** Crossfades two states with a short blur, so the eye reads one value changing. */
function Swap({ t, from, to, style }: { t: number; from: ReactNode; to: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ position: "relative", display: "inline-grid", ...style }}>
      <span style={{ gridArea: "1 / 1", opacity: 1 - t, filter: `blur(${t * 6}px)` }}>{from}</span>
      <span style={{ gridArea: "1 / 1", opacity: t, filter: `blur(${(1 - t) * 6}px)` }}>{to}</span>
    </span>
  );
}

function Metric({ label, value, accent = false, size, style }: { label: string; value: ReactNode; accent?: boolean; size: number; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div style={{ borderTop: `${2 * u}px solid ${C.border}`, paddingTop: 22 * u, ...style }}>
      <Label>{label}</Label>
      <div style={{ marginTop: 14 * u, fontFamily: sans, fontWeight: 600, fontSize: size, letterSpacing: "-0.04em", color: accent ? C.primary : C.fg, whiteSpace: "nowrap", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. "A fund wants to buy a large block, quietly."
// ---------------------------------------------------------------------------
const TAPE = ["cTBILL 100.48", "cBOND 98.12", "cTBILL 100.51", "cUSDC 1.0000", "cTBILL 100.47", "cETH 3,412.20", "cTBILL 100.53", "cBOND 98.09"];

/** A market tape scrolling behind the order; it blurs out as the order goes private. */
function Tape({ y, dir, hush }: { y: number; dir: 1 | -1; hush: number }) {
  const frame = useCurrentFrame();
  const { u, width } = useLayout();
  const text = [...TAPE, ...TAPE, ...TAPE].map((t, i) => `${t} ${i % 3 ? "▲" : "▼"}`).join("     ");
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: 0,
        whiteSpace: "nowrap",
        fontFamily: mono,
        fontSize: 30 * u,
        color: C.taupe,
        opacity: 0.32 - 0.2 * hush,
        filter: `blur(${hush * 7}px)`,
        transform: `translateX(${dir === 1 ? -frame * 2.2 * u : -width * 0.6 + frame * 2.2 * u}px)`,
      }}
    >
      {text}
    </div>
  );
}

function SceneOrder() {
  const frame = useCurrentFrame();
  const { u, wide, height } = useLayout();
  const panel = usePop(6);
  const hush = useProgress(14, 46);
  const size = Math.round(interpolate(frame, [12, 44], [0, 1_000_000], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut }));
  const pill = usePop(44);
  return (
    <>
      <Tape y={height * 0.16} dir={1} hush={hush} />
      <Tape y={height * 0.8} dir={-1} hush={hush} />
      <Center>
        <div style={panel.style}>
          <Panel label="Trade request · buyer" style={{ width: (wide ? 1080 : 940) * u }}>
            <Label>Buy</Label>
            <div style={{ display: "flex", alignItems: "baseline", gap: 24 * u, marginTop: 10 * u }}>
              <span style={{ fontFamily: sans, fontWeight: 600, fontSize: (wide ? 170 : 148) * u, letterSpacing: "-0.05em", color: C.primary, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {fmt(size)}
              </span>
              <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 64 * u, color: C.fg, letterSpacing: "-0.03em" }}>cTBILL</span>
            </div>
            <div style={{ display: "flex", gap: 18 * u, marginTop: 34 * u, ...pill.style }}>
              <Pill tone="live" label="Not broadcast" />
              <Pill label="Settle in cUSDC" />
            </div>
          </Panel>
        </div>
      </Center>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. "First, a risk officer approves a mandate: the dealers, the size, the maximum price."
// ---------------------------------------------------------------------------
function Signature({ party, delay }: { party: string; delay: number }) {
  const { u } = useLayout();
  const pop = usePop(delay);
  return (
    <div style={{ ...pop.style, display: "flex", alignItems: "center", gap: 14 * u, border: `${2 * u}px solid ${C.primary}55`, background: `${C.primary}12`, borderRadius: 18 * u, padding: `${14 * u}px ${22 * u}px` }}>
      <CheckIcon size={30 * u} />
      <span style={{ fontFamily: mono, fontSize: 30 * u, color: C.fg, whiteSpace: "nowrap" }}>{party}</span>
      <Label color={C.primary} style={{ fontSize: 22 * u }}>
        Signed
      </Label>
    </div>
  );
}

function SceneMandate() {
  const { u, wide } = useLayout();
  const panel = usePop(4);
  const fields = [
    { label: "Dealers", value: "dealerA · dealerB", at: 16 },
    { label: "Max size", value: "1,000,000 cTBILL", at: 34, accent: true },
    { label: "Max price", value: "101.00", at: 52, accent: true },
    { label: "Settle in", value: "cUSDC", at: 70 },
  ];
  const approved = useProgress(112, 124);
  return (
    <Center>
      <div style={panel.style}>
        <Panel
          label="Treasury mandate"
          style={{ width: (wide ? 1240 : 960) * u }}
          badge={<Swap t={approved} from={<Pill label="Pending" />} to={<Pill tone="live" label="Approved" />} />}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 40 * u, rowGap: 34 * u }}>
            {fields.map((f) => (
              <Field key={f.label} {...f} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 20 * u, marginTop: 40 * u, flexWrap: "wrap" }}>
            <Signature party="buyer" delay={84} />
            <Signature party="riskOfficer" delay={100} />
          </div>
        </Panel>
      </div>
    </Center>
  );
}

function Field({ label, value, at, accent }: { label: string; value: string; at: number; accent?: boolean }) {
  const { u, wide } = useLayout();
  const pop = usePop(at);
  return (
    <div style={pop.style}>
      <Metric label={label} value={value} accent={accent} size={(wide ? 58 : 50) * u} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. "The agent cannot trade past it. The ledger says no."
// ---------------------------------------------------------------------------
function LogLine({ at, resultAt, command, ok, result }: { at: number; resultAt: number; command: string; ok: boolean; result: string }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const n = Math.max(0, Math.floor((frame - at) * 1.6));
  const res = usePop(resultAt);
  const color = ok ? C.primary : C.failed;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 * u, fontFamily: mono, fontSize: 30 * u, opacity: frame >= at ? 1 : 0 }}>
      <span style={{ color: C.fg, whiteSpace: "nowrap" }}>
        <span style={{ color: C.purple }}>agent ›</span> {command.slice(0, n)}
        {n < command.length ? <span style={{ color: C.primary }}>▍</span> : null}
      </span>
      <span style={{ ...res.style, display: "flex", alignItems: "center", gap: 12 * u, color, whiteSpace: "nowrap", transformOrigin: "left center" }}>
        {ok ? <CheckIcon size={30 * u} /> : <CrossIcon size={30 * u} />}
        {result}
      </span>
    </div>
  );
}

function SceneCap() {
  const frame = useCurrentFrame();
  const { u, wide } = useLayout();
  const panel = usePop(2);
  const width = (wide ? 1240 : 960) * u;
  const track = width - 80 * u;
  // The request bar overshoots the cap, is refused and snaps back, then a valid request fills to it.
  const over = interpolate(frame, [10, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const back = interpolate(frame, [40, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut });
  const valid = interpolate(frame, [62, 84], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  const cap = 2 / 3;
  const fill = frame < 56 ? over * (1 - back) : valid * cap;
  const refused = frame >= 36 && frame < 56;
  const shake = frame >= 36 && frame < 52 ? Math.sin((frame - 36) * 1.9) * 12 * u * (1 - (frame - 36) / 16) : 0;
  return (
    <Center>
      <div style={{ ...panel.style, transform: `${panel.style.transform} translateX(${shake}px)` }}>
        <Panel label="OpenRfq · mandate check" style={{ width }} badge={<Pill tone={refused ? "failed" : frame >= 86 ? "live" : "muted"} label={refused ? "Refused" : frame >= 86 ? "RFQ open" : "Checking"} />}>
          <div style={{ position: "relative", height: 150 * u, marginBottom: 30 * u }}>
            <div style={{ position: "absolute", left: track * cap, top: 0, transform: "translateX(-50%)" }}>
              <Label color={C.primary}>Cap 1,000,000</Label>
            </div>
            <div style={{ position: "absolute", top: 64 * u, left: 0, width: track, height: 44 * u, borderRadius: 12 * u, background: C.secondary, border: `${2 * u}px solid ${C.border}`, overflow: "hidden" }}>
              <div style={{ width: track * fill, height: "100%", background: frame < 56 ? `linear-gradient(90deg, ${C.primary}, ${C.failed} 70%)` : C.primary, opacity: 0.9 }} />
            </div>
            <div style={{ position: "absolute", left: track * cap - 2 * u, top: 48 * u, width: 4 * u, height: 76 * u, background: C.primary, borderRadius: 4 * u }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 28 * u }}>
            <LogLine at={8} resultAt={36} command={`size ${wide ? "1,500,000  " : "1.5M  "}maxPrice 101.40`} ok={false} result="Rejected · exceeds mandate cap" />
            <LogLine at={58} resultAt={86} command={`size ${wide ? "1,000,000  " : "1.0M  "}maxPrice 101.00`} ok result="RFQ_CREATED · RFQ-DEMO-1789858005273" />
          </div>
        </Panel>
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 4. "Two dealers quote blind. Neither sees the other's price."
// ---------------------------------------------------------------------------
function SealedQuote({ dealer, delay, seed, compact }: { dealer: string; delay: number; seed: number; compact: boolean }) {
  const { u, wide } = useLayout();
  const pop = usePop(delay);
  return (
    <div style={pop.style}>
      <Panel label={`Quote · ${dealer}`} style={{ width: (compact ? 900 : wide ? 640 : 500) * u }}>
        <Label>Price</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 20 * u, marginTop: 14 * u }}>
          <LockIcon size={50 * u} color={C.lilac} />
          <Cipher length={9} seed={seed} style={{ fontSize: 66 * u, color: C.lilac, letterSpacing: "0.04em" }} />
        </div>
        <div style={{ marginTop: 28 * u, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 24 * u, rowGap: 10 * u, fontFamily: mono, fontSize: 28 * u }}>
          <Label>Signatory</Label>
          <span style={{ color: C.fg }}>{dealer}</span>
          <Label>Observer</Label>
          <span style={{ color: C.fg }}>buyer</span>
        </div>
      </Panel>
    </div>
  );
}

function SceneSealed() {
  const { u, wide, tall } = useLayout();
  const banner = usePop(52);
  const zero = usePop(64, { damping: 11 });
  return (
    <Center style={{ flexDirection: "column", gap: 44 * u, paddingTop: !wide && !tall ? 70 * u : 0 }}>
      <div style={{ display: "flex", flexDirection: wide ? "row" : "column", gap: (wide ? 60 : 30) * u, transform: !wide && !tall ? "scale(0.84)" : undefined, margin: !wide && !tall ? `${-70 * u}px 0` : 0 }}>
        <SealedQuote dealer="dealerA" delay={6} seed={3} compact={!wide} />
        <SealedQuote dealer="dealerB" delay={26} seed={91} compact={!wide} />
      </div>
      <div
        style={{
          ...banner.style,
          display: "flex",
          alignItems: "center",
          gap: 22 * u,
          border: `${2 * u}px solid ${C.primary}66`,
          background: `${C.primary}0f`,
          borderRadius: 24 * u,
          padding: `${20 * u}px ${32 * u}px`,
          fontFamily: mono,
          fontSize: (wide ? 32 : 28) * u,
          color: C.fg,
          whiteSpace: "nowrap",
        }}
      >
        <LockIcon size={34 * u} />
        <span>
          <span style={{ color: C.primary }}>dealerB</span> sees
        </span>
        <span style={{ ...zero.style, display: "inline-block", fontFamily: sans, fontWeight: 600, fontSize: 64 * u, color: C.primary, lineHeight: 1 }}>0</span>
        <span>of dealerA's quotes</span>
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 5. "The lowest price wins, by a rule anyone can check."
// ---------------------------------------------------------------------------
function QuoteRow({ dealer, price, won, y, decrypt, verdictAt, lift }: { dealer: string; price: string; won: boolean; y: number; decrypt: number; verdictAt: number; lift: number }) {
  const frame = useCurrentFrame();
  const { u, wide } = useLayout();
  const verdict = usePop(verdictAt);
  const glow = useProgress(verdictAt - 4, verdictAt + 8);
  const lit = won ? glow : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: y,
        height: 110 * u,
        display: "flex",
        alignItems: "center",
        gap: 24 * u,
        padding: `0 ${30 * u}px`,
        borderRadius: 22 * u,
        border: `${2 * u}px solid ${won && lit > 0 ? `rgba(243, 255, 151, ${0.15 + 0.45 * lit})` : C.border}`,
        background: won ? `color-mix(in oklch, ${C.primary} ${7 * lit}%, ${C.secondary})` : C.secondary,
        zIndex: won ? 2 : 1,
        transform: `scale(${won ? 1 + 0.025 * lift : 1 - 0.02 * lift})`,
        opacity: won ? 1 : 1 - 0.35 * lift,
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontFamily: mono, fontSize: 34 * u, color: won && lit > 0.5 ? C.primary : C.fg }}>{dealer}</span>
      {wide && <span style={{ fontFamily: mono, fontSize: 24 * u, color: C.taupe }}>BID-{dealer.toUpperCase()}-RFQ-DEMO</span>}
      <span style={{ flex: 1 }} />
      <Swap
        t={decrypt}
        from={<Cipher length={6} seed={dealer.length + (won ? 7 : 0) + Math.floor(frame / 30)} style={{ fontSize: 40 * u, color: C.lilac }} />}
        to={<span style={{ fontFamily: mono, fontSize: 44 * u, color: C.fg }}>{price}</span>}
        style={{ justifyItems: "end" }}
      />
      <span style={{ ...verdict.style, width: 190 * u, display: "flex", justifyContent: "flex-end" }}>
        {won ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u, background: C.primary, color: C.bg, borderRadius: 999, padding: `${8 * u}px ${20 * u}px`, fontFamily: mono, fontWeight: 500, fontSize: 24 * u, letterSpacing: "0.12em" }}>
            <CheckIcon size={24 * u} color={C.bg} /> SEALED
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 * u, border: `${2 * u}px solid ${C.border}`, color: C.taupe, borderRadius: 999, padding: `${6 * u}px ${20 * u}px`, fontFamily: mono, fontSize: 24 * u, letterSpacing: "0.12em" }}>
            <CrossIcon size={22 * u} color={C.taupe} /> LOST
          </span>
        )}
      </span>
    </div>
  );
}

function SceneAward() {
  const frame = useCurrentFrame();
  const { u, wide } = useLayout();
  const panel = usePop(2);
  const decrypt = useProgress(8, 22);
  // The cheaper quote travels to the top of the ranking (ease-in-out: on-screen travel).
  const rank = easeInOut(interpolate(frame, [30, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const rowStep = 132 * u;
  // While the rows pass, the winner lifts above the other one.
  const lift = Math.sin(rank * Math.PI);
  const rule = usePop(72);
  return (
    <Center>
      <div style={panel.style}>
        <Panel label="Quote proposals · buyer view" style={{ width: (wide ? 1240 : 960) * u }}>
          <div style={{ position: "relative", height: rowStep + 110 * u }}>
            <QuoteRow dealer="dealerB" price="100.50" won={false} y={rank * rowStep} decrypt={decrypt} verdictAt={66} lift={lift} />
            <QuoteRow dealer="dealerA" price="100.20" won y={(1 - rank) * rowStep} decrypt={decrypt} verdictAt={56} lift={lift} />
          </div>
          <div style={{ ...rule.style, transformOrigin: "left center", display: "flex", alignItems: "center", gap: 20 * u, marginTop: 36 * u }}>
            <Label>Award rule</Label>
            <span style={{ fontFamily: mono, fontSize: 32 * u, color: C.primary, whiteSpace: "nowrap" }}>LowestPriceThenBidId</span>
          </div>
        </Panel>
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 6. "Securities and cash move together, in one transaction, or not at all."
// ---------------------------------------------------------------------------
const COMMIT = 62;

function Party({ name, before, after, delay, compact }: { name: string; before: [number, number]; after: [number, number]; delay: number; compact: boolean }) {
  const { u } = useLayout();
  const pop = usePop(delay);
  const t = useProgress(COMMIT, COMMIT + 12);
  const flash = interpolate(useCurrentFrame(), [COMMIT, COMMIT + 6, COMMIT + 30], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rows = [
    { asset: "cTBILL", from: before[0], to: after[0] },
    { asset: "cUSDC", from: before[1], to: after[1] },
  ];
  return (
    <div style={pop.style}>
      <Panel label={name} badge={<span />} style={{ width: (compact ? 960 : 460) * u, padding: `${28 * u}px ${34 * u}px`, boxShadow: `0 0 ${60 * u * flash}px rgba(243, 255, 151, ${0.25 * flash})` }}>
        <div style={{ display: "flex", flexDirection: compact ? "row" : "column", gap: (compact ? 40 : 22) * u }}>
          {rows.map((r) => (
            <div key={r.asset} style={{ flex: 1 }}>
              <Label>{r.asset}</Label>
              <div style={{ marginTop: 8 * u, fontFamily: sans, fontWeight: 600, fontSize: 46 * u, letterSpacing: "-0.04em", whiteSpace: "nowrap" }}>
                <Swap t={t} from={<span style={{ color: C.fg }}>{fmt(r.from)}</span>} to={<span style={{ color: r.to > r.from ? C.primary : C.taupe }}>{fmt(r.to)}</span>} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Leg({ name, detail, delay }: { name: string; detail: string; delay: number }) {
  const { u } = useLayout();
  const pop = usePop(delay);
  const done = useProgress(COMMIT, COMMIT + 10);
  return (
    <div style={{ ...pop.style, display: "flex", alignItems: "center", gap: 18 * u, padding: `${16 * u}px 0`, borderTop: `${2 * u}px solid ${C.border}` }}>
      <Swap t={done} from={<span style={{ width: 30 * u, height: 30 * u, display: "grid", placeItems: "center" }}><span style={{ width: 14 * u, height: 14 * u, borderRadius: 99, background: "#71717a" }} /></span>} to={<CheckIcon size={30 * u} />} />
      <span style={{ fontFamily: mono, fontSize: 30 * u, color: C.fg, whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ flex: 1 }} />
      <Label style={{ fontSize: 22 * u }}>{detail}</Label>
    </div>
  );
}

function SceneSettle() {
  const frame = useCurrentFrame();
  const { u, wide, tall } = useLayout();
  const tx = usePop(4);
  const verified = usePop(COMMIT + 18);
  // A sweep of light crosses the transaction as every leg commits at once.
  const sweep = interpolate(frame, [COMMIT - 4, COMMIT + 12], [-0.2, 1.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const connector = (
    <div style={{ width: wide ? 50 * u : 4 * u, height: wide ? 4 * u : 30 * u, background: frame >= COMMIT ? C.primary : C.border, borderRadius: 4 * u }} />
  );
  return (
    <Center style={{ flexDirection: "column", gap: 34 * u, paddingTop: !wide && !tall ? 70 * u : 0 }}>
      <div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", transform: !wide && !tall ? "scale(0.84)" : undefined, margin: !wide && !tall ? `${-60 * u}px 0` : 0 }}>
        <Party name="buyer" before={[0, 100_200_000]} after={[1_000_000, 0]} delay={10} compact={!wide} />
        {connector}
        <div style={{ ...tx.style, position: "relative" }}>
          <Panel label="submitMany" badge={<Pill tone={frame >= COMMIT ? "live" : "muted"} label="1 transaction" />} style={{ width: (wide ? 720 : 960) * u, overflow: "hidden", position: "relative" }}>
            <Leg name="Deal.Settle" detail="receipt" delay={12} />
            <Leg name="ExecuteTransfer" detail="cTBILL leg" delay={22} />
            <Leg name="ExecuteTransfer" detail="cUSDC leg" delay={32} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(100deg, transparent ${sweep * 100 - 14}%, rgba(243, 255, 151, 0.16) ${sweep * 100}%, transparent ${sweep * 100 + 14}%)`,
                pointerEvents: "none",
              }}
            />
          </Panel>
        </div>
        {connector}
        <Party name="dealerA" before={[1_000_000, 0]} after={[0, 100_200_000]} delay={20} compact={!wide} />
      </div>
      <div style={verified.style}>
        <Pill tone="ok" label="DvP verified · atomic" />
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 7. "Every number on screen comes from the ledger."
// ---------------------------------------------------------------------------
function Counted({ to, digits, start, end }: { to: number; digits: number; start: number; end: number }) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [start, end], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut });
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(digits ? v : Math.round(v), digits)}</span>;
}

function FromLedger({ delay }: { delay: number }) {
  const { u } = useLayout();
  const pop = usePop(delay);
  return (
    <div style={{ ...pop.style, transformOrigin: "left center", display: "flex", alignItems: "center", gap: 10 * u, marginTop: 14 * u }}>
      <CheckIcon size={24 * u} />
      <Label color={C.primary} style={{ fontSize: 22 * u }}>
        From ledger
      </Label>
    </div>
  );
}

function SceneReceipt() {
  const { u, wide } = useLayout();
  const panel = usePop(2);
  const size = (wide ? 72 : 62) * u;
  const metrics = [
    { label: "Quantity", value: <Counted to={1_000_000} digits={0} start={8} end={36} />, accent: true, tag: 30 },
    { label: "Unit price", value: <Counted to={100.2} digits={2} start={14} end={40} />, accent: false, tag: 40 },
    { label: "Total value", value: <Counted to={100_200_000} digits={0} start={20} end={48} />, accent: true, tag: 50 },
  ];
  return (
    <Center>
      <div style={panel.style}>
        <Panel label="Settlement" badge={<Pill tone="ok" label="DvP verified" />} style={{ width: (wide ? 1340 : 960) * u }}>
          <div style={{ fontFamily: mono, fontSize: 32 * u, color: C.fg, marginBottom: 34 * u }}>{DEAL}</div>
          <div style={{ display: "grid", gridTemplateColumns: wide ? "1fr 1fr 1.4fr" : "1fr 1fr", columnGap: 40 * u, rowGap: 34 * u }}>
            {metrics.map((m, i) => (
              <div key={m.label} style={!wide && i === 2 ? { gridColumn: "1 / 3" } : undefined}>
                <Metric label={m.label} value={m.value} accent={m.accent} size={size} />
                <FromLedger delay={m.tag} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 8. "Shadow Desk. Approve. Quote. Award. Settle. Private execution, on Canton."
// ---------------------------------------------------------------------------
function Step({ word, at, last }: { word: string; at: number; last?: boolean }) {
  const pop = usePop(at);
  return <span style={{ ...pop.style, display: "inline-block", color: last ? C.primary : C.fg }}>{word}</span>;
}

function SceneLogo() {
  const frame = useCurrentFrame();
  const { u, wide } = useLayout();
  const draw = useProgress(0, 34);
  const word = usePop(14);
  const tagline = usePop(102);
  const url = usePop(118);
  // A very slow push-in, so the end card never sits completely still.
  const drift = 1 + interpolate(frame, [0, 170], [0, 0.03]);
  const steps = [
    { word: "Approve.", at: 36 },
    { word: "Quote.", at: 50 },
    { word: "Award.", at: 62 },
    { word: "Settle.", at: 76 },
  ];
  return (
    <Center style={{ flexDirection: "column", gap: 40 * u, textAlign: "center", transform: `scale(${drift})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34 * u }}>
        <Mark size={(wide ? 150 : 130) * u} draw={draw} />
        <div style={{ ...word.style, fontFamily: sans, fontWeight: 500, fontSize: (wide ? 96 : 76) * u, letterSpacing: "0.22em", color: C.fg, whiteSpace: "nowrap" }}>SHADOWDESK</div>
      </div>
      <div style={{ display: "flex", gap: (wide ? 28 : 20) * u, fontFamily: sans, fontWeight: 600, fontSize: (wide ? 80 : 60) * u, letterSpacing: "-0.04em", whiteSpace: "nowrap" }}>
        {steps.map((s, i) => (
          <Step key={s.word} {...s} last={i === steps.length - 1} />
        ))}
      </div>
      <div style={tagline.style}>
        <Label style={{ fontSize: 30 * u, letterSpacing: "0.26em" }}>Private execution on Canton</Label>
      </div>
      <div
        style={{
          ...url.style,
          marginTop: 6 * u,
          fontFamily: sans,
          fontWeight: 500,
          fontSize: 34 * u,
          color: C.bg,
          background: C.primary,
          borderRadius: 999,
          padding: `${16 * u}px ${40 * u}px`,
          boxShadow: `0 0 ${60 * u}px rgba(243, 255, 151, 0.25)`,
        }}
      >
        shadowdesk-inky.vercel.app
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------

/** A scene with a short fade at each end, so cuts never feel like jumps. */
function Scene({ from, to, kicker, children }: { from: number; to: number; kicker?: [string, string]; children: ReactNode }) {
  return (
    <Sequence from={from} durationInFrames={to - from} layout="none">
      <FadeEdges length={to - from}>
        {kicker && <Kicker step={kicker[0]} title={kicker[1]} />}
        {children}
      </FadeEdges>
    </Sequence>
  );
}

function FadeEdges({ length, children }: { length: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6, length - 6, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

export function Intro({ withVoiceover = true }: { withVoiceover?: boolean }) {
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Backdrop />
      <Scene {...SCENES.order} kicker={["01", "Block order"]}>
        <SceneOrder />
      </Scene>
      <Scene {...SCENES.mandate} kicker={["02", "Approve"]}>
        <SceneMandate />
      </Scene>
      <Scene {...SCENES.cap} kicker={["03", "Policy cap"]}>
        <SceneCap />
      </Scene>
      <Scene {...SCENES.sealed} kicker={["04", "Sealed quotes"]}>
        <SceneSealed />
      </Scene>
      <Scene {...SCENES.award} kicker={["05", "Award"]}>
        <SceneAward />
      </Scene>
      <Scene {...SCENES.settle} kicker={["06", "Atomic settlement"]}>
        <SceneSettle />
      </Scene>
      <Scene {...SCENES.receipt} kicker={["07", "Receipt"]}>
        <SceneReceipt />
      </Scene>
      <Scene {...SCENES.logo}>
        <SceneLogo />
      </Scene>
      {withVoiceover &&
        Object.values(SCENES).map(({ vo }) => (
          <Sequence key={vo.id} from={vo.at} layout="none">
            <Audio src={staticFile(`voiceover/${vo.id}.wav`)} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
