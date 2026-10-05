/**
 * Glucose graph: readings as dots (in range / out of range), target band, carbs and insulin markers.
 * Hand-drawn SVG so it matches the Android redesign exactly and stays tiny.
 */
import { useMemo } from 'preact/hooks';
import type { Treatment } from '../core/treatment';
import { bolusUnitsOf } from '../core/treatment';
import type { Reading } from '../ns/client';
import { trim } from './format';

interface Props {
  readings: readonly Reading[];
  entries: readonly Treatment[];
  hours: number;
  low: number;
  high: number;
  now: number;
  onPickEntry?: (t: Treatment) => void;
}

const W = 360;
const H = 280;
const PAD_L = 26;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

export function Chart({ readings, entries, hours, low, high, now, onPickEntry }: Props) {
  const view = useMemo(() => {
    const end = now + Math.min(30, hours * 2.5) * 60_000;
    const start = now - hours * 3_600_000;
    const pts = readings.filter((r) => r.timestamp >= start && r.timestamp <= end);
    const maxBg = Math.max(12, ...pts.map((p) => p.mmol + 1));
    const yMax = Math.ceil(maxBg / 2) * 2;
    const yMin = 0;
    const x = (ts: number) => PAD_L + ((ts - start) / (end - start)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);
    const ticks: number[] = [];
    for (let v = 2; v < yMax; v += 2) ticks.push(v);
    const hourStep = hours <= 3 ? 1 : hours <= 6 ? 1 : hours <= 12 ? 2 : 4;
    const timeTicks: number[] = [];
    const first = new Date(start);
    first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3_600_000; t < end; t += 3_600_000) {
      if (new Date(t).getHours() % hourStep === 0) timeTicks.push(t);
    }
    const marks = entries.filter((t) => t.timestamp >= start && t.timestamp <= end && (t.carbs > 0 || bolusUnitsOf(t) > 0 || t.notes));
    return { pts, x, y, ticks, timeTicks, marks, yMax };
  }, [readings, entries, hours, now]);

  const { pts, x, y, ticks, timeTicks, marks } = view;
  const r = hours <= 3 ? 2.6 : hours <= 6 ? 2.1 : hours <= 12 ? 1.7 : 1.3;

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="График сахара">
      <rect x={PAD_L} y={y(high)} width={W - PAD_L - PAD_R} height={Math.max(0, y(low) - y(high))} fill="rgba(55,200,163,0.06)" />
      {ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="#22252c" stroke-width="0.6" />
          <text x={PAD_L - 5} y={y(v) + 3.5} fill="#949aa3" font-size="10" text-anchor="end">
            {v}
          </text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={y(high)} y2={y(high)} stroke="#f2b33d" stroke-width="0.9" />
      <line x1={PAD_L} x2={W - PAD_R} y1={y(low)} y2={y(low)} stroke="#e5484d" stroke-width="0.9" />
      {timeTicks.map((t) => (
        <g key={`t${t}`}>
          <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={H - PAD_B} stroke="#1d2027" stroke-width="0.6" />
          <text x={x(t)} y={H - 6} fill="#949aa3" font-size="10" text-anchor="middle">
            {String(new Date(t).getHours()).padStart(2, '0')}
          </text>
        </g>
      ))}
      <line x1={x(now)} x2={x(now)} y1={PAD_T} y2={H - PAD_B} stroke="#2b2f38" stroke-width="0.8" stroke-dasharray="3 3" />
      {pts.map((p) => {
        const out = p.mmol > high || p.mmol < low;
        return <circle key={p.timestamp} cx={x(p.timestamp)} cy={y(p.mmol)} r={r} fill={p.mmol < low ? '#e5484d' : out ? '#f2b33d' : '#4cc2f1'} />;
      })}
      {marks.map((t, i) => {
        const bolus = bolusUnitsOf(t);
        const label = `${bolus > 0 ? `${trim(bolus, 1)}u` : ''}${t.carbs > 0 ? `${trim(t.carbs, 0)}g` : ''}`;
        const cx = x(t.timestamp);
        const cy = Math.min(H - PAD_B - 12, Math.max(PAD_T + 22, y(4.6) - (i % 2) * 18));
        const wide = Math.max(18, label.length * 6.4 + 8);
        return (
          <g key={t.id} onClick={() => onPickEntry?.(t)} style={{ cursor: onPickEntry ? 'pointer' : 'default' }}>
            {label ? (
              <>
                <rect x={cx - wide / 2} y={cy - 22} width={wide} height={15} rx={3} fill={t.carbs > 0 ? '#5f8f12' : '#2f6fb3'} />
                <text x={cx} y={cy - 11} fill="#fff" font-size="10.5" font-weight="800" text-anchor="middle">
                  {label}
                </text>
                <circle cx={cx} cy={cy} r={4.2} fill="#fff" />
                <circle cx={cx} cy={cy} r={2.4} fill={t.carbs > 0 ? '#5f8f12' : '#2f6fb3'} />
              </>
            ) : (
              <rect x={cx - 5} y={cy - 6} width={10} height={12} rx={2} fill="#c2c7ce" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
