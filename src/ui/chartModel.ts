/**
 * Pure rules of the home graph, copied from the Android app (BgGraphBuilder) so the site draws the
 * same picture: where a treatment marker sits, what its label says, how close entries merge, and the
 * time grid. No DOM here — unit-tested in tests/chart.test.ts.
 */
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import { HOUR_MS, MINUTE_MS } from '../core/units';

/** The part of time the main graph shows. */
export interface View {
  /** Right edge (ms). */
  end: number;
  /** Width (ms). */
  span: number;
}

export const MIN_SPAN = 30 * MINUTE_MS;
export const MAX_SPAN = 24 * HOUR_MS;
export const DEFAULT_SPAN = 4 * HOUR_MS;

/** Empty space after "now" on the right, as on the phone (room for the latest dots and the "+" button). */
export function futureMargin(span: number): number {
  return Math.min(45 * MINUTE_MS, span * 0.15);
}

/** Keeps a view inside the data: not wider than 24 h, not past now + margin, not before the oldest data. */
export function clampView(v: View, now: number, oldest: number): View {
  const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, v.span));
  const maxEnd = now + futureMargin(span);
  const minEnd = Math.min(maxEnd, oldest + span);
  return { span, end: Math.min(maxEnd, Math.max(minEnd, v.end)) };
}

/** A view that follows "now" (its right edge is the future margin). */
export function liveView(span: number, now: number): View {
  return { span, end: now + futureMargin(span) };
}

/** Phone rule: a dose sits at its units (15.5 U → 15.5 on the mmol axis), else at 6; kept between the low and high lines. */
export function markerY(t: Pick<Treatment, 'insulin' | 'insulinJSON'>, low: number, high: number): number {
  const insulin = bolusUnitsOf(t);
  const v = insulin > 0 ? insulin : 6;
  return Math.min(high, Math.max(low, v));
}

/** xDrip's JoH.qs: up to {@code digits} decimals, dot separator, trailing zeros dropped. */
function qs(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

/** Phone label: "15.5u130g", "2u", "74g" (dot decimals, as xDrip prints them). */
export function markerLabel(t: Pick<Treatment, 'insulin' | 'insulinJSON' | 'carbs'>): string {
  const insulin = bolusUnitsOf(t);
  let label = '';
  if (insulin > 0) label += `${qs(insulin, 2)}u`;
  if (t.carbs > 0) label += `${qs(t.carbs, 1)}g`;
  return label;
}

export interface Marker {
  entry: Treatment;
  y: number;
  /** Shown label ("" when it was merged into the previous marker's label). */
  label: string;
  /** Index of the marker whose label shows this entry: its own, or the one it was merged into. */
  owner: number;
  noteOnly: boolean;
}

/** Markers for the entries in time order; entries within 10 min merge their labels with "+" (phone rule). */
export function buildMarkers(entries: readonly Treatment[], low: number, high: number): Marker[] {
  const out: Marker[] = [];
  let lastLabelled = -1;
  for (const t of [...entries].sort((a, b) => a.timestamp - b.timestamp)) {
    const insulin = bolusUnitsOf(t);
    const noteOnly = !(t.carbs > 0) && !(insulin > 0);
    if (noteOnly && !(t.notes && t.notes.trim())) continue;
    const m: Marker = { entry: t, y: noteOnly ? Math.min(high, Math.max(low, 6)) : markerY(t, low, high), label: noteOnly ? '' : markerLabel(t), owner: out.length, noteOnly };
    const head = out[lastLabelled];
    if (!noteOnly && head && t.timestamp - head.entry.timestamp < 10 * MINUTE_MS && head.label) {
      head.label = `${head.label}+${m.label}`;
      m.label = '';
      m.owner = lastLabelled;
    }
    out.push(m);
    if (!noteOnly && m.label) lastLabelled = out.length - 1;
  }
  return out;
}

/** Where the graph draws a marker's label: a 20 px high box centred over the dot, 10–30 px above it. */
export function labelBox(label: string, mx: number, my: number): { x: number; y: number; w: number; h: number } {
  const w = label.length * 7.4 + 10;
  return { x: mx - w / 2, y: my - 30, w, h: 20 };
}

/** How far from a dot a finger still hits it, and the slack around a label (screen px). */
const DOT_REACH = 30;
const LABEL_SLACK = 8;

/**
 * The entry a tap at (px, py) means: the nearest dot within a finger's reach, or any point of a green
 * label (plus a little slack). A merged label ("12u80g+2u") stands for all its entries and the meal
 * among them wins, so tapping the label opens the meal. Null when no marker is that close.
 * {@code at} gives a marker's dot in screen pixels.
 */
export function pickMarker(markers: readonly Marker[], px: number, py: number, at: (m: Marker) => [number, number]): Treatment | null {
  let best: { d: number; meal: boolean; dot: number; t: Treatment } | null = null;
  for (const m of markers) {
    const [mx, my] = at(m);
    const dot = Math.hypot(mx - px, (my - py) * 0.8);
    let d = dot <= DOT_REACH ? dot : Infinity;
    const owner = markers[m.owner];
    if (owner?.label) {
      const [ox, oy] = at(owner);
      const b = labelBox(owner.label, ox, oy);
      const outside = Math.hypot(Math.max(b.x - px, 0, px - b.x - b.w), Math.max(b.y - py, 0, py - b.y - b.h));
      if (outside <= LABEL_SLACK) d = Math.min(d, outside);
    }
    if (d === Infinity) continue;
    const c = { d, meal: m.entry.carbs > 0, dot, t: m.entry };
    if (!best || c.d < best.d - 0.5 || (Math.abs(c.d - best.d) <= 0.5 && (c.meal !== best.meal ? c.meal : c.dot < best.dot))) best = c;
  }
  return best ? best.t : null;
}

/** Time grid: every 30 min / 1 h / 2 h / 4 h depending on how wide the view is. */
export function timeTicks(start: number, end: number): number[] {
  const span = end - start;
  const step = span <= 3 * HOUR_MS ? 30 * MINUTE_MS : span <= 8 * HOUR_MS ? HOUR_MS : span <= 16 * HOUR_MS ? 2 * HOUR_MS : 4 * HOUR_MS;
  const first = new Date(start);
  first.setMinutes(first.getMinutes() < 30 || step >= HOUR_MS ? 0 : 30, 0, 0);
  const out: number[] = [];
  for (let t = first.getTime(); t <= end; t += step) {
    if (t < start) continue;
    // align multi-hour steps to the clock (00, 02, 04 …)
    if (step >= 2 * HOUR_MS && new Date(t).getHours() % (step / HOUR_MS) !== 0) continue;
    out.push(t);
  }
  return out;
}

/** Glucose axis: 0/2 … up to at least 12, a bit above the highest value in view. */
export function yRange(values: readonly number[], low: number): { min: number; max: number } {
  let hi = 12;
  let lo = Math.min(3, low - 1);
  for (const v of values) {
    if (v + 1 > hi) hi = v + 1;
    if (v - 0.5 < lo) lo = v - 0.5;
  }
  return { min: Math.max(0, Math.floor(lo)), max: Math.ceil(hi / 2) * 2 };
}
