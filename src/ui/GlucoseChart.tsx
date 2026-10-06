/**
 * The home graph, drawn like the phone's: glucose dots (blue in range, yellow high, red low), the high
 * and low lines, the target line, finger-sticks, and food / insulin markers with the phone's labels.
 * Drawn in real screen pixels (no stretching on a wide screen).
 *
 * Gestures: drag to scroll in time, two fingers / mouse wheel to zoom, tap a meal to open it, tap a
 * dot to see its value. The view itself lives in the parent so the overview strip shares it.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Treatment } from '../core/treatment';
import type { MeterReading, Reading } from '../ns/client';
import { buildMarkers, clampView, labelBox, pickMarker, timeTicks, yRange, type View } from './chartModel';
import { hhmm, mmol } from './format';
import { useSize } from './useSize';

interface Props {
  readings: readonly Reading[];
  entries: readonly Treatment[];
  meter: readonly MeterReading[];
  low: number;
  high: number;
  target: number;
  now: number;
  oldest: number;
  view: View;
  onView: (v: View, byUser: boolean) => void;
  onPickEntry: (t: Treatment) => void;
  children?: ComponentChildren;
}

const PAD_L = 30;
const PAD_R = 4;
const PAD_T = 10;
const PAD_B = 24;
const TAP_SLOP = 8;

const C = {
  grid: '#1f222a',
  gridV: '#1a1d23',
  axis: '#949aa3',
  high: '#f2b33d',
  low: '#e5484d',
  target: '#3f6b35',
  inRange: '#4cc2f1',
  hi: '#f2b33d',
  lo: '#e5484d',
  marker: '#6aa121',
  note: '#c2c7ce',
};

/** All points of one colour as one path of zero-length round-capped segments — fast even for 1-min data. */
function dotsPath(points: Array<[number, number]>): string {
  let d = '';
  for (const [x, y] of points) d += `M${x.toFixed(1)} ${y.toFixed(1)}h0`;
  return d;
}

export function GlucoseChart({ readings, entries, meter, low, high, target, now, oldest, view, onView, onPickEntry, children }: Props) {
  const [box, size] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const w = size.w;
  const h = size.h;
  const plotW = Math.max(1, w - PAD_L - PAD_R);
  const plotH = Math.max(1, h - PAD_T - PAD_B);
  const start = view.end - view.span;

  const model = useMemo(() => {
    const visible = readings.filter((r) => r.timestamp >= start - 60_000 && r.timestamp <= view.end + 60_000);
    const yr = yRange(visible.map((r) => r.mmol), low);
    return { visible, yr, markers: buildMarkers(entries.filter((t) => t.timestamp >= start - 3_600_000 && t.timestamp <= view.end + 3_600_000), low, high) };
  }, [readings, entries, start, view.end, low, high]);

  const x = (ts: number) => PAD_L + ((ts - start) / view.span) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - model.yr.min) / (model.yr.max - model.yr.min)) * plotH;

  // --- gestures -------------------------------------------------------------------------------
  const live = useRef({ view, size: { plotW }, onView, oldest, now });
  live.current = { view, size: { plotW }, onView, oldest, now };
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    startView: View;
    startX: number;
    startY: number;
    startDist: number;
    startMid: number;
    /** The graph is being dragged or pinched. */
    moved: boolean;
    /** Still a tap: one finger that has stayed on its spot (however long it is held). */
    tap: boolean;
  } | null>(null);

  const localX = (e: PointerEvent | WheelEvent) => {
    const r = svg.current?.getBoundingClientRect();
    return r ? e.clientX - r.left : 0;
  };
  const localY = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    return r ? e.clientY - r.top : 0;
  };

  const emit = (v: View) => {
    const { now: n, oldest: o, onView: cb } = live.current;
    cb(clampView(v, n, o), true);
  };

  const onPointerDown = (e: PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer — still handle the gesture */
    }
    const g = gesture.current ?? { pointers: new Map(), startView: view, startX: 0, startY: 0, startDist: 0, startMid: 0, moved: false, tap: false };
    g.pointers.set(e.pointerId, { x: localX(e), y: localY(e) });
    g.startView = live.current.view;
    g.tap = g.pointers.size === 1;
    if (g.pointers.size === 1) {
      g.startX = localX(e);
      g.startY = localY(e);
      g.moved = false;
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      if (a && b) {
        g.startDist = Math.max(10, Math.abs(a.x - b.x));
        g.startMid = (a.x + b.x) / 2;
        g.moved = true;
      }
    }
    gesture.current = g;
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: localX(e), y: localY(e) });
    const pw = live.current.size.plotW;
    if (g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      if (!a || !b) return;
      const dist = Math.max(10, Math.abs(a.x - b.x));
      const mid = (a.x + b.x) / 2;
      const sv = g.startView;
      const span = sv.span * (g.startDist / dist);
      // keep the moment under the fingers' midpoint where it was
      const tMid = sv.end - sv.span + ((g.startMid - PAD_L) / pw) * sv.span;
      const newStart = tMid - ((mid - PAD_L) / pw) * span;
      emit({ end: newStart + span, span });
      return;
    }
    const dx = localX(e) - g.startX;
    if (Math.abs(dx) > TAP_SLOP) g.moved = true;
    if (Math.hypot(dx, localY(e) - g.startY) > TAP_SLOP) g.tap = false;
    if (g.moved) emit({ end: g.startView.end - (dx / pw) * g.startView.span, span: g.startView.span });
  };

  // a finger / button lifted; a cancelled pointer (the browser took it over) is never a tap
  const release = (e: PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (!g) return;
    const wasTap = !cancelled && g.tap && !g.moved && g.pointers.size === 1 && g.pointers.has(e.pointerId);
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 1) {
      // second finger lifted: continue as a one-finger drag from here
      const [rest] = [...g.pointers.values()];
      g.startView = live.current.view;
      g.startX = rest ? rest.x : 0;
      g.startY = rest ? rest.y : 0;
    }
    if (g.pointers.size === 0) gesture.current = null;
    if (wasTap) hitTest(localX(e), localY(e));
  };

  // mouse wheel / trackpad: zoom around the cursor; sideways scroll pans
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view: v, size: s } = live.current;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        emit({ end: v.end + (e.deltaX / s.plotW) * v.span, span: v.span });
        return;
      }
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      const span = v.span * factor;
      const px = localX(e);
      const tAt = v.end - v.span + ((px - PAD_L) / s.plotW) * v.span;
      const newStart = tAt - ((px - PAD_L) / s.plotW) * span;
      emit({ end: newStart + span, span });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [w > 0]);

  useEffect(() => {
    if (!tip) return;
    const id = setTimeout(() => setTip(null), 3500);
    return () => clearTimeout(id);
  }, [tip]);

  function hitTest(px: number, py: number) {
    // a food / insulin / note marker first (its dot within a finger's reach, or anywhere on its label), then the nearest dot
    const picked = pickMarker(model.markers, px, py, (m) => [x(m.entry.timestamp), y(m.y)]);
    if (picked) {
      setTip(null);
      onPickEntry(picked);
      return;
    }
    let near: Reading | null = null;
    let nd = 24;
    for (const r of model.visible) {
      const d = Math.abs(x(r.timestamp) - px);
      if (d < nd) {
        nd = d;
        near = r;
      }
    }
    for (const m of meter) {
      const d = Math.hypot(x(m.timestamp) - px, y(m.mmol) - py);
      if (d < 22) {
        setTip({ x: x(m.timestamp), y: y(m.mmol), text: `${mmol(m.mmol)} · из пальца · ${hhmm(m.timestamp)}` });
        return;
      }
    }
    setTip(near ? { x: x(near.timestamp), y: y(near.mmol), text: `${mmol(near.mmol)} ммоль/л · ${hhmm(near.timestamp)}` } : null);
  }

  // --- drawing --------------------------------------------------------------------------------
  const ready = w > 0 && h > 0;
  const r = view.span <= 3 * 3_600_000 ? 4.2 : view.span <= 6 * 3_600_000 ? 3.4 : view.span <= 12 * 3_600_000 ? 2.6 : 2;
  const inPts: Array<[number, number]> = [];
  const hiPts: Array<[number, number]> = [];
  const loPts: Array<[number, number]> = [];
  if (ready) {
    for (const p of model.visible) {
      const pt: [number, number] = [x(p.timestamp), y(p.mmol)];
      if (p.mmol < low) loPts.push(pt);
      else if (p.mmol > high) hiPts.push(pt);
      else inPts.push(pt);
    }
  }
  const ticksY: number[] = [];
  for (let v = Math.ceil(model.yr.min / 2) * 2; v <= model.yr.max; v += 2) ticksY.push(v);

  return (
    <div class="gchart" ref={box}>
      <svg
        ref={svg}
        class="gchart-svg"
        width={w}
        height={h}
        viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        // the graph handles its own taps: no follow-up "click" from the browser, which would land on the
        // meal card the tap has just opened (on its dimmed backdrop, closing it at once)
        onTouchEnd={(e) => e.cancelable && e.preventDefault()}
        role="img"
        aria-label="График сахара"
      >
        {ready && (
          <>
            {ticksY.map((v) => (
              <g key={`y${v}`}>
                <line x1={PAD_L} x2={w - PAD_R} y1={y(v)} y2={y(v)} stroke={C.grid} stroke-width="1" />
                <text x={PAD_L - 6} y={y(v) + 4} fill={C.axis} font-size="12" text-anchor="end">
                  {v}
                </text>
              </g>
            ))}
            {timeTicks(start, view.end).map((t) => {
              const d = new Date(t);
              const label = d.getMinutes() === 0 ? String(d.getHours()).padStart(2, '0') : `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
              return (
                <g key={`t${t}`}>
                  <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={h - PAD_B} stroke={C.gridV} stroke-width="1" />
                  <text x={x(t)} y={h - 7} fill={C.axis} font-size="12" text-anchor="middle">
                    {label}
                  </text>
                </g>
              );
            })}
            <line x1={PAD_L} x2={w - PAD_R} y1={y(high)} y2={y(high)} stroke={C.high} stroke-width="1.2" />
            <line x1={PAD_L} x2={w - PAD_R} y1={y(low)} y2={y(low)} stroke={C.low} stroke-width="1.2" />
            <line x1={PAD_L} x2={w - PAD_R} y1={y(target)} y2={y(target)} stroke={C.target} stroke-width="1.2" stroke-dasharray="6 5" />
            {now >= start && now <= view.end && <line x1={x(now)} x2={x(now)} y1={PAD_T} y2={h - PAD_B} stroke="#2b2f38" stroke-width="1" stroke-dasharray="3 4" />}

            <path d={dotsPath(inPts)} stroke={C.inRange} stroke-width={r * 2} stroke-linecap="round" fill="none" />
            <path d={dotsPath(hiPts)} stroke={C.hi} stroke-width={r * 2} stroke-linecap="round" fill="none" />
            <path d={dotsPath(loPts)} stroke={C.lo} stroke-width={r * 2} stroke-linecap="round" fill="none" />

            {meter
              .filter((m) => m.timestamp >= start && m.timestamp <= view.end)
              .map((m) => (
                <circle key={`m${m.timestamp}`} cx={x(m.timestamp)} cy={y(m.mmol)} r={6} fill="#fff" stroke={C.lo} stroke-width="3" />
              ))}

            {model.markers.map((m) => {
              const mx = x(m.entry.timestamp);
              const my = y(m.y);
              if (mx < PAD_L - 40 || mx > w + 40) return null;
              if (m.noteOnly) {
                return <rect key={m.entry.id} x={mx - 6} y={my - 7} width={12} height={14} rx={2} fill={C.note} />;
              }
              const b = labelBox(m.label, mx, my);
              return (
                <g key={m.entry.id}>
                  {m.label && (
                    <>
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={C.marker} />
                      <text x={mx} y={my - 15.5} fill="#fff" font-size="13" font-weight="800" text-anchor="middle">
                        {m.label}
                      </text>
                    </>
                  )}
                  <circle cx={mx} cy={my} r={7} fill="#fff" />
                  <rect x={mx - 3.4} y={my - 3.4} width={6.8} height={6.8} fill={C.marker} transform={`rotate(45 ${mx} ${my})`} />
                </g>
              );
            })}
            {tip && (
              <g pointer-events="none">
                <circle cx={tip.x} cy={tip.y} r={r + 3} fill="none" stroke="#fff" stroke-width="2" />
              </g>
            )}
          </>
        )}
      </svg>
      {tip && (
        <div class="gchart-tip" style={{ left: `${Math.min(Math.max(tip.x, 70), w - 70)}px`, top: `${Math.max(tip.y - 46, 4)}px` }}>
          {tip.text}
        </div>
      )}
      {children}
    </div>
  );
}
