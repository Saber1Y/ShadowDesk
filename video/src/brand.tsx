import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

/** The dashboard's tokens (frontend/app/globals.css), so the film and the product look like one thing. */
export const C = {
  bg: "#030206",
  fg: "#fffffc",
  card: "oklch(0.14 0.016 300 / 0.82)",
  secondary: "oklch(0.17 0.022 300)",
  primary: "#f3ff97",
  lilac: "#d5a5e3",
  purple: "#875cff",
  taupe: "#a89f91",
  border: "#fffffc1c",
  ok: "#34d399",
  failed: "#f87171",
} as const;

export const sans = loadGeist("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const mono = loadGeistMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

/** The dashboard's ease-out curve ([0.16, 1, 0.3, 1]) approximated as a strong cubic ease-out. */
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Layout helpers: everything is sized in units of the short side, so 16:9, 1:1 and 9:16 all work. */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  return { width, height, u, wide: width / height > 1.3, tall: height / width > 1.3 };
}

/**
 * Entrance from 92% scale and transparent, never from zero. Calmer than a playful brand: the
 * dashboard is an institutional console, so the spring barely overshoots.
 */
export function usePop(delay = 0, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 170, mass: 0.7, ...config } });
  return {
    p,
    style: {
      opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
      transform: `translateY(${(1 - p) * 14}px) scale(${0.92 + 0.08 * p})`,
    } as CSSProperties,
  };
}

/** 0..1 over a frame range, eased out. */
export function useProgress(start: number, end: number) {
  const frame = useCurrentFrame();
  return easeOut(interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
}

export const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** The small uppercase mono label used across the dashboard (PARTICIPANT FABRIC, QUOTE PROPOSALS). */
export function Label({ children, color = C.taupe, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <span style={{ fontFamily: mono, fontSize: 26 * u, letterSpacing: "0.18em", textTransform: "uppercase", color, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

/** lucide's Lock, drawn inline so the film has no icon dependency. */
export function LockIcon({ size, color = C.primary }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function CheckIcon({ size, color = C.primary }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CrossIcon({ size, color = C.failed }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** The dashboard's HudPanel: a glassy card with a mono label, a lime dot and a PRIVATE badge. */
export function Panel({ label, badge, children, style }: { label: string; badge?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div
      style={{
        background: C.card,
        border: `${2 * u}px solid ${C.border}`,
        borderRadius: 30 * u,
        padding: `${34 * u}px ${40 * u}px`,
        boxShadow: `0 ${30 * u}px ${80 * u}px #00000066`,
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 * u, marginBottom: 30 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 * u }}>
          <span style={{ width: 12 * u, height: 12 * u, borderRadius: 99, background: C.primary }} />
          <Label>{label}</Label>
        </div>
        {badge ?? (
          <span style={{ display: "flex", alignItems: "center", gap: 10 * u }}>
            <LockIcon size={24 * u} />
            <Label color={C.primary} style={{ fontSize: 22 * u }}>
              Private
            </Label>
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** The dashboard's StatusPill. */
export function Pill({ label, tone = "muted", style }: { label: string; tone?: "live" | "ok" | "muted" | "failed"; style?: CSSProperties }) {
  const { u } = useLayout();
  const dot = tone === "live" ? C.primary : tone === "ok" ? C.ok : tone === "failed" ? C.failed : "#71717a";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14 * u,
        borderRadius: 999,
        border: `${2 * u}px solid ${tone === "failed" ? `${C.failed}66` : C.border}`,
        background: C.card,
        padding: `${10 * u}px ${24 * u}px`,
        fontFamily: mono,
        fontSize: 24 * u,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: tone === "failed" ? C.failed : C.taupe,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ width: 12 * u, height: 12 * u, borderRadius: 99, background: dot }} />
      {label}
    </span>
  );
}

/** The four-arc ShadowDesk mark; `draw` (0..1) strokes the arcs in one after another. */
export function Mark({ size, draw = 1 }: { size: number; draw?: number }) {
  const arcs = [
    { d: "M28.62 31.03 A14 14 0 0 1 9.28 29.00", stroke: "#875CFF" },
    { d: "M9.28 29.00 A14 14 0 0 1 9.28 11.00", stroke: "#F3FF97" },
    { d: "M9.28 11.00 A14 14 0 0 1 27.00 7.88", stroke: "#D5A5E3" },
    { d: "M27.00 7.88 A14 14 0 0 1 33.69 17.09", stroke: "#FFFFFC" },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      {arcs.map((a, i) => {
        const t = Math.min(1, Math.max(0, draw * arcs.length - i));
        return <path key={a.d} d={a.d} stroke={a.stroke} strokeWidth={5.5} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - easeOut(t)} />;
      })}
    </svg>
  );
}

/** The near-black page with the dashboard's lime glow and a faint purple one; both drift slowly. */
export function Backdrop() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 110) * 5;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at ${18 + drift}% -12%, rgba(243, 255, 151, 0.13), transparent 42%), radial-gradient(circle at ${102 - drift}% 108%, ${C.purple}26, transparent 45%), ${C.bg}`,
      }}
    />
  );
}
