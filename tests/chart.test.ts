import { describe, expect, it } from 'vitest';
import { buildMarkers, clampView, futureMargin, markerLabel, markerY, MAX_SPAN, MIN_SPAN, timeTicks } from '../src/ui/chartModel';
import type { Treatment } from '../src/core/treatment';

const t = (timestamp: number, carbs: number, insulin: number, notes: string | null = null): Treatment => ({ id: String(timestamp), timestamp, carbs, insulin, notes });
const H = 3_600_000;
const M = 60_000;

describe('treatment markers, as the phone draws them', () => {
  it('sit at the dose in units, else at 6, between the low and high lines', () => {
    expect(markerY(t(0, 130, 15.5), 3.9, 9.4)).toBe(9.4);
    expect(markerY(t(0, 0, 2), 3.9, 9.4)).toBe(3.9);
    expect(markerY(t(0, 0, 5), 3.9, 9.4)).toBe(5);
    expect(markerY(t(0, 74, 0), 3.9, 9.4)).toBe(6);
  });
  it('labels like xDrip: dot decimals, u then g', () => {
    expect(markerLabel(t(0, 130, 15.5))).toBe('15.5u130g');
    expect(markerLabel(t(0, 0, 2))).toBe('2u');
    expect(markerLabel(t(0, 74, 0))).toBe('74g');
    expect(markerLabel(t(0, 12.5, 1.25))).toBe('1.25u12.5g');
  });
  it('merge labels of entries within 10 minutes', () => {
    const m = buildMarkers([t(0, 60, 6), t(5 * M, 0, 2), t(30 * M, 0, 1)], 3.9, 9.4);
    expect(m.map((x) => x.label)).toEqual(['6u60g+2u', '', '1u']);
  });
  it('show notes, skip empty entries', () => {
    const m = buildMarkers([t(0, 0, 0, 'бег'), t(H, 0, 0, null)], 3.9, 9.4);
    expect(m).toHaveLength(1);
    expect(m[0]?.noteOnly).toBe(true);
  });
});

describe('view limits', () => {
  const now = 1_791_270_000_000;
  it('never wider than 24 h nor narrower than 30 min', () => {
    expect(clampView({ end: now, span: 100 * H }, now, now - 96 * H).span).toBe(MAX_SPAN);
    expect(clampView({ end: now, span: M }, now, now - 96 * H).span).toBe(MIN_SPAN);
  });
  it('not past now (plus the margin), not before the oldest data', () => {
    expect(clampView({ end: now + 10 * H, span: 4 * H }, now, now - 96 * H).end).toBe(now + futureMargin(4 * H));
    expect(clampView({ end: now - 200 * H, span: 4 * H }, now, now - 96 * H).end).toBe(now - 92 * H);
  });
  it('hour grid inside the view', () => {
    const ticks = timeTicks(now - 4 * H, now);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (const x of ticks) expect(new Date(x).getMinutes()).toBe(0);
  });
});
