import { useEffect, useId, useState, type CSSProperties } from "react";

/* ==========================================================================
   Rolodex logo / loader
   A tiny 3D model (cards hinged on an axle, carried by an open frame: two
   rounded-triangle rings joined by the axle and two floor rails) projected
   orthographically at a 45° angle into flat SVG shapes. While loading, the cards rotate around the axle like
   flipping through the wheel.
   ========================================================================== */

export interface LogoProps {
  /** Rendered width/height. Number = px. */
  size?: number | string;
  /** Ink color. Every shade in the mark is mixed from this and `background`. */
  color?: string;
  /** Surface color the mark sits on (lightest card face). */
  background?: string;
  /** Flip through the cards like a search in progress. */
  loading?: boolean;
  /** Milliseconds per card flip while loading. */
  flipDuration?: number;
  /** Accessible label. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/* ---- Model (arbitrary 3D units; axle = X axis, Y up, Z toward viewer) ---- */
const CARD_W = 62; // along the axle
const R_IN = 7; // card's inner edge distance from axle
const R_OUT = 45; // card's outer edge distance from axle
const CORNER = 3.5;
const STROKE = 2.2;

/* Frame: two rounded-triangle rings (a hollow triangular prism), axle at the apex */
const FRAME_X = CARD_W / 2 + 4.5; // rings sit just outside the cards
const RING_T = 3.2; // ring thickness along the axle
const APEX_Y = 11; // outer apex height above the axle
const FLOOR_Y = -49; // desk, low enough for cards to swing through
const SLOPE = (60 * Math.PI) / 180; // ring sides, from horizontal
const BASE_HALF = (APEX_Y - FLOOR_Y) / Math.tan(SLOPE);
const RING_W = 8.5; // ring band width
const ROUND_OUT = [12, 10, 10]; // apex, back foot, front foot
const ROUND_IN = [6, 5, 5];
const RAIL_W = 4.2;
const AXLE_W = 3.4;
const HUB_R = 4.4;

/* Angle of each slot around the axle, in degrees (0 = straight up, + = leaning back).
   Slot 0 is the exposed card; the rest are the 7 cards beneath it: a fan leaning
   back and a stack lying forward. The list loops, so while loading, cards travel
   all the way around inside the hollow frame. */
const SLOTS = [0, 34, 54, 74, 94, 218, 240, 262];
const RING = SLOTS.length;

/* Card shading: % of ink mixed into each card face per slot away from the exposed card */
const SHADE_STEP = 9;
const SHADE_MAX = 34;

/* ---- Camera: 45° yaw, looking slightly down ---- */
const YAW = Math.PI / 4;
const PITCH = (24 * Math.PI) / 180;
const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);

type V3 = [number, number, number];
type V2 = [number, number];

/** Returns [screenX, screenY, depth] with depth larger = closer to viewer. */
function project([x, y, z]: V3): [number, number, number] {
  const xr = x * cy - z * sy;
  const zr = x * sy + z * cy;
  const yUp = y * cp - zr * sp;
  return [xr, -yUp, zr * cp + y * sp];
}

/* Fit the model into a 128 × 128 viewBox */
const SCALE = 1.0;
const CX = 64;
const CY = 57;
const toView = (p: V3): V2 => {
  const [x, y] = project(p);
  return [CX + x * SCALE, CY + y * SCALE];
};

/* ---- Shape helpers ---- */
const pathOf = (pts: V2[]) =>
  "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
const projectPath = (pts: V3[]) => pathOf(pts.map(toView));

function roundedRect(x: number, y: number, w: number, h: number, r: number): V2[] {
  const pts: V2[] = [];
  const corners: [number, number, number][] = [
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
    [x + w - r, y + r, 270],
  ];
  for (const [ccx, ccy, start] of corners) {
    for (let i = 0; i <= 5; i++) {
      const a = ((start + (i * 90) / 5) * Math.PI) / 180;
      pts.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)]);
    }
  }
  return pts;
}
function circle(x: number, y: number, r: number, n = 28): V2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [x + r * Math.cos(a), y + r * Math.sin(a)] as V2;
  });
}
/** Polygon with each corner replaced by a quadratic curve of the given reach. */
function roundedPolygon(verts: V2[], reach: number[], steps = 8): V2[] {
  const out: V2[] = [];
  verts.forEach((v, i) => {
    const prev = verts[(i + verts.length - 1) % verts.length];
    const next = verts[(i + 1) % verts.length];
    const toward = (p: V2, d: number): V2 => {
      const len = Math.hypot(p[0] - v[0], p[1] - v[1]);
      return [v[0] + ((p[0] - v[0]) / len) * d, v[1] + ((p[1] - v[1]) / len) * d];
    };
    const a = toward(prev, reach[i]);
    const b = toward(next, reach[i]);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push([
        (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * v[0] + t ** 2 * b[0],
        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * v[1] + t ** 2 * b[1],
      ]);
    }
  });
  return out;
}

/** Ink/background blend, so every shade stays in the brand's single hue. */
const mix = (ink: string, bg: string, inkPct: number) =>
  inkPct <= 0 ? bg : inkPct >= 100 ? ink : `color-mix(in srgb, ${ink} ${Math.round(inkPct)}%, ${bg})`;

/* ---- Frame geometry (precomputed once) ----
   Cross-section in (z, y): apex at the top, back and front feet on the desk. */
const TRI: V2[] = [
  [0, APEX_Y],
  [-BASE_HALF, FLOOR_Y],
  [BASE_HALF, FLOOR_Y],
];
// Inner triangle: the outer one shrunk toward its incenter by the band width
const INRADIUS = (APEX_Y - FLOOR_Y) / 3; // equilateral (60° sides)
const INCENTER: V2 = [0, FLOOR_Y + INRADIUS];
const shrink = (INRADIUS - RING_W) / INRADIUS;
const TRI_IN = TRI.map(([z, y]): V2 => [
  INCENTER[0] + (z - INCENTER[0]) * shrink,
  INCENTER[1] + (y - INCENTER[1]) * shrink,
]);
const OUTER = roundedPolygon(TRI, ROUND_OUT);
const INNER = roundedPolygon(TRI_IN, ROUND_IN);
const at = (x: number) => (p: V2): V3 => [x, p[1], p[0]];

/** A ring at x: outer outline plus inner outline (cut out with even-odd fill). */
const ring = (x: number) => projectPath(OUTER.map(at(x))) + projectPath(INNER.map(at(x)));
const FAR_RING_EDGE = ring(-FRAME_X - RING_T / 2);
const FAR_RING = ring(-FRAME_X + RING_T / 2);
const NEAR_RING_EDGE = ring(FRAME_X - RING_T / 2);
const NEAR_RING = ring(FRAME_X + RING_T / 2);

/** A straight bar between two 3D points (drawn as a round-capped stroke). */
const bar = (a: V3, b: V3) => {
  const [p, q] = [toView(a), toView(b)];
  return `M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
};
// Rails run between the rings through the centre of each rounded foot
const footY = FLOOR_Y + RING_W / 2;
const footZ = BASE_HALF - RING_W / 2 / Math.tan(SLOPE / 2);
const BACK_RAIL = bar([-FRAME_X, footY, -footZ], [FRAME_X, footY, -footZ]);
const FRONT_RAIL = bar([-FRAME_X, footY, footZ], [FRAME_X, footY, footZ]);
const AXLE = bar([-FRAME_X, 0, 0], [FRAME_X, 0, 0]);
const HUB = projectPath(circle(0, 0, HUB_R, 32).map(at(FRAME_X + RING_T / 2 + 0.01)));
const HUB_PIN = projectPath(circle(0, 0, HUB_R * 0.4, 20).map(at(FRAME_X + RING_T / 2 + 0.02)));

/* Tones, as % ink — a small, fixed palette keeps the mark crisp */
const TONE = { nearRing: 100, nearEdge: 70, rail: 78, farRing: 46, farEdge: 34, axle: 60 };

/* ---- Cards ---- */
function slotAngleDeg(s: number): number {
  const i = Math.floor(s) % RING;
  const from = SLOTS[i];
  let to = i + 1 < RING ? SLOTS[i + 1] : SLOTS[0] + 360;
  if (to < from) to += 360;
  return from + (to - from) * (s - Math.floor(s));
}
/** Card-local (u along axle, v radial from axle) → 3D, for a card at angle phi. */
const onCard = (phi: number) => (u: number, v: number): V3 => [u, v * Math.cos(phi), -v * Math.sin(phi)];

const CARD_OUTLINE = roundedRect(-CARD_W / 2, R_IN, CARD_W, R_OUT - R_IN, CORNER);
const FACE = [
  circle(-CARD_W / 2 + 14, R_OUT - 13, 6.5),
  roundedRect(-CARD_W / 2 + 26, R_OUT - 11.5, 22, 3.6, 1.8),
  roundedRect(-CARD_W / 2 + 26, R_OUT - 18.5, 13, 3.6, 1.8),
  roundedRect(-CARD_W / 2 + 8, R_IN + 9, 44, 3.6, 1.8),
];

interface CardShape {
  key: number;
  outline: string;
  face: string[];
  faceOpacity: number;
  shade: number;
  depth: number;
}

/** Cards at a given flip progress t (t = 0 is the logo; each +1 is one card flipped). */
function cardsAt(t: number): CardShape[] {
  const cards: CardShape[] = [];
  for (let i = 0; i < RING; i++) {
    const s = (((i - t) % RING) + RING) % RING; // continuous slot in [0, RING)
    const deg = slotAngleDeg(s);
    const f = onCard((deg * Math.PI) / 180);
    const away = Math.min(s, RING - s); // slots from the exposed position
    const faceOpacity = Math.max(0, 1 - away * 1.4);
    cards.push({
      key: i,
      outline: projectPath(CARD_OUTLINE.map(([u, v]) => f(u, v))),
      face: faceOpacity > 0 ? FACE.map((shape) => projectPath(shape.map(([u, v]) => f(u, v)))) : [],
      faceOpacity,
      shade: Math.min(SHADE_MAX, away * SHADE_STEP),
      depth: project(f(0, (R_IN + R_OUT) / 2))[2],
    });
  }
  return cards.sort((a, b) => a.depth - b.depth);
}

/* Snappy flip: quick ease-in-out, then a short rest on each card */
function flipProgress(elapsedMs: number, flipMs: number): number {
  const n = elapsedMs / flipMs;
  const whole = Math.floor(n);
  const frac = Math.min(1, (n - whole) / 0.72);
  const eased = frac < 0.5 ? 4 * frac ** 3 : 1 - (-2 * frac + 2) ** 3 / 2;
  return whole + eased;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** A single still frame of the mark. `progress` 0 is the logo. */
export function LogoFrame({
  progress = 0,
  size = 64,
  color = "#16181d",
  background = "#ffffff",
  title = "Rolodex",
  className,
  style,
  busy,
  pulse,
}: Omit<LogoProps, "loading" | "flipDuration"> & { progress?: number; busy?: boolean; pulse?: boolean }) {
  const id = "rdx" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const cards = cardsAt(progress);
  const fill = (pct: number) => ({ fill: mix(color, background, pct) });
  const stroke = (pct: number) => ({ stroke: mix(color, background, pct) });
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      role="img"
      aria-label={busy ? `${title}, loading` : title}
      aria-busy={busy || undefined}
      className={[pulse ? `${id}-pulse` : "", className].filter(Boolean).join(" ") || undefined}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      {pulse && (
        <style>{`.${id}-pulse{animation:${id}-p 1.4s ease-in-out infinite}@keyframes ${id}-p{50%{opacity:.45}}`}</style>
      )}

      {/* Far side of the frame, seen through the hollow middle */}
      <path d={FAR_RING_EDGE} style={fill(TONE.farEdge)} fillRule="evenodd" />
      <path d={FAR_RING} style={fill(TONE.farRing)} fillRule="evenodd" />
      <path d={BACK_RAIL} style={stroke(TONE.rail)} strokeWidth={RAIL_W} strokeLinecap="round" fill="none" />
      <path d={AXLE} style={stroke(TONE.axle)} strokeWidth={AXLE_W} strokeLinecap="round" fill="none" />

      {/* Cards, back to front */}
      {cards.map((c) => (
        <g key={c.key}>
          <path d={c.outline} style={fill(c.shade)} stroke={color} strokeWidth={STROKE} strokeLinejoin="round" />
          {c.face.length > 0 && (
            <g fill={color} opacity={c.faceOpacity < 1 ? c.faceOpacity : undefined}>
              {c.face.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          )}
        </g>
      ))}

      {/* Near side of the frame with the axle hub */}
      <path d={FRONT_RAIL} style={stroke(TONE.rail)} strokeWidth={RAIL_W} strokeLinecap="round" fill="none" />
      <path d={NEAR_RING_EDGE} style={fill(TONE.nearEdge)} fillRule="evenodd" />
      <path d={NEAR_RING} style={fill(TONE.nearRing)} fillRule="evenodd" />
      <path d={HUB} fill={background} />
      <path d={HUB_PIN} fill={color} />
    </svg>
  );
}

export default function Logo({ loading = false, flipDuration = 650, ...rest }: LogoProps) {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!loading || reduced) {
      setProgress(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setProgress(flipProgress(now - start, flipDuration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loading, reduced, flipDuration]);

  return <LogoFrame {...rest} progress={progress} busy={loading} pulse={loading && reduced} />;
}
