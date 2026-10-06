/**
 * The strip under the graph, as on the phone: the last 24 h of glucose as a line, the high / low
 * lines, white diamonds for food and insulin, and a frame showing which part the big graph shows.
 * Drag or tap the strip to move that frame.
 */
import { useMemo, useRef } from 'preact/hooks';
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import { HOUR_MS } from '../core/units';
import type { Reading } from '../ns/client';
import { clampView, markerY, type View } from './chartModel';
import { useSize } from './useSize';

interface Props {
  readings: readonly Reading[];
  entries: readonly Treatment[];
  low: number;
  high: number;
  now: number;
  oldest: number;
  view: View;
  onView: (v: View, byUser: boolean) => void;
}

const PAD_B = 14;

export function Overview({ readings, entries, low, high, now, oldest, view, onView }: Props) {
  const [box, size] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const w = size.w;
  const h = size.h;
  const start = now - 24 * HOUR_MS;
  const end = now + HOUR_MS;
  const span = end - start;
  const yMax = 14;
  const yMin = 2;
  const x = (ts: number) => ((ts - start) / span) * w;
  const y = (v: number) => 4 + (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin)) * (h - PAD_B - 6);

  const line = useMemo(() => {
    if (w <= 0) return '';
    // one point per 5 min is plenty for a strip this small
    let d = '';
    let lastTs = -Infinity;
    let pen = false;
    for (const r of readings) {
      if (r.timestamp < start || r.timestamp > end) continue;
      if (r.timestamp - lastTs < 5 * 60_000 && pen) continue;
      const gap = r.timestamp - lastTs > 20 * 60_000;
      d += `${gap || !pen ? 'M' : 'L'}${x(r.timestamp).toFixed(1)} ${y(r.mmol).toFixed(1)}`;
      pen = true;
      lastTs = r.timestamp;
    }
    return d;
  }, [readings, start, w, h]);

  const drag = useRef<boolean>(false);
  const moveTo = (clientX: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || w <= 0) return;
    const t = start + ((clientX - rect.left) / w) * span;
    onView(clampView({ end: t + view.span / 2, span: view.span }, now, oldest), true);
  };

  const ready = w > 0 && h > 0;
  const vx1 = Math.max(0, x(view.end - view.span));
  const vx2 = Math.min(w, x(view.end));
  return (
    <div class="overview" ref={box}>
      <svg
        ref={svg}
        width={w}
        height={h}
        viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
        onPointerDown={(e) => {
          try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer — still handle the gesture */
    }
          drag.current = true;
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => drag.current && moveTo(e.clientX)}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
        aria-label="Обзор за сутки"
      >
        {ready && (
          <>
            <line x1={0} x2={w} y1={y(high)} y2={y(high)} stroke="#f2b33d" stroke-width="1" />
            <line x1={0} x2={w} y1={y(low)} y2={y(low)} stroke="#e5484d" stroke-width="1" />
            <path d={line} stroke="#4cc2f1" stroke-width="1.6" fill="none" stroke-linejoin="round" />
            {entries
              .filter((t) => t.timestamp >= start && t.timestamp <= end && (t.carbs > 0 || bolusUnitsOf(t) > 0))
              .map((t) => {
                const cx = x(t.timestamp);
                const cy = y(markerY(t, low, high));
                return <rect key={t.id} x={cx - 3.2} y={cy - 3.2} width={6.4} height={6.4} fill="#fff" transform={`rotate(45 ${cx} ${cy})`} />;
              })}
            {Array.from({ length: 25 }, (_, i) => {
              const d = new Date(start);
              d.setMinutes(0, 0, 0);
              const t = d.getTime() + (i + 1) * HOUR_MS;
              if (t > end) return null;
              return (
                <text key={i} x={x(t)} y={h - 3} fill="#949aa3" font-size="9" text-anchor="middle">
                  {String(new Date(t).getHours()).padStart(2, '0')}
                </text>
              );
            })}
            <rect x={vx1} y={1} width={Math.max(4, vx2 - vx1)} height={h - PAD_B} rx={3} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.45)" stroke-width="1.2" />
          </>
        )}
      </svg>
    </div>
  );
}
