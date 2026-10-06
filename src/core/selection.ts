/** Pure picking of the inputs for one meal — port of CarbRatioDataSelection.java. */
import { actedFraction, remainingFraction } from './insulin';
import type { Supplement } from './calculator';
import { DAY_MS, HOUR_MS } from './units';

export interface BgPoint {
  timestamp: number;
  mmol: number;
}

export interface InsulinEvent {
  timestamp: number;
  bolusUnits: number;
  attached: boolean;
}

export interface CarbEvent {
  timestamp: number;
  grams: number;
  attached: boolean;
}

export function pickNearest(
  readings: readonly BgPoint[] | null | undefined,
  target: number,
  radiusMs: number,
  earliestAllowed: number,
  latestAllowed: number,
): BgPoint | null {
  let best: BgPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  if (!readings) return null;
  for (const point of readings) {
    if (!point || point.timestamp > latestAllowed || point.timestamp < earliestAllowed) continue;
    const distance = Math.abs(point.timestamp - target);
    if (distance <= radiusMs && distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

export function pickStart(
  readings: readonly BgPoint[] | null | undefined,
  mealTime: number,
  forwardToleranceMs: number,
  maxLookbackMs: number,
): BgPoint | null {
  return pickNearest(readings, mealTime, maxLookbackMs, Number.NEGATIVE_INFINITY, mealTime + forwardToleranceMs);
}

export function targetEndTime(mealTime: number, workoutMs: number, nextMealTime: number | null): number {
  const full = mealTime + workoutMs;
  if (nextMealTime !== null && nextMealTime > mealTime && nextMealTime < full) return nextMealTime;
  return full;
}

export function isReadyToCompute(mealTime: number, workoutMs: number, nextMealTime: number | null, now: number): boolean {
  return now >= targetEndTime(mealTime, workoutMs, nextMealTime);
}

export function pickEnd(
  readings: readonly BgPoint[] | null | undefined,
  mealTime: number,
  workoutMs: number,
  nextMealTime: number | null,
  toleranceMs: number,
  radiusMs: number,
): BgPoint | null {
  const target = targetEndTime(mealTime, workoutMs, nextMealTime);
  return pickNearest(readings, target, radiusMs, Number.NEGATIVE_INFINITY, target + toleranceMs);
}

/**
 * Doses "at the same moment" as the meal (its own insulin, or a separate entry typed right next to
 * it) are shown as the meal's bolus. Every dose is weighed by time the same way — this only groups.
 */
export const SAME_MOMENT_MS = 2 * 60_000;

/**
 * Share of a dose injected at {@code doseTime} that acts inside the meal's window [mealTime, endTime],
 * off the 5-part activity curve over {@code actionHours} ("СК_отработки"). Consecutive meals' windows
 * never overlap, so one dose is split between meals by time and never counted twice.
 */
export function shareInWindow(doseTime: number, mealTime: number, endTime: number, actionHours: number): number {
  if (!(actionHours > 0) || endTime <= mealTime || doseTime >= endTime) return 0;
  const share = actedFraction((endTime - doseTime) / HOUR_MS, actionHours) - actedFraction((mealTime - doseTime) / HOUR_MS, actionHours);
  return share > 0 ? share : 0;
}

/** Units of the meal's own bolus — doses within SAME_MOMENT_MS of the meal. */
export function sumBolus(events: readonly InsulinEvent[] | null | undefined, mealTime: number): number {
  let sum = 0;
  for (const e of events ?? []) {
    if (e && Math.abs(e.timestamp - mealTime) <= SAME_MOMENT_MS) sum += e.bolusUnits;
  }
  return sum;
}

/** Part of the meal's own bolus acting inside [mealTime, endTime]: 1 unless the next meal cut the window. */
export function bolusShare(events: readonly InsulinEvent[] | null | undefined, mealTime: number, endTime: number, actionHours: number): number {
  let raw = 0;
  let effective = 0;
  for (const e of events ?? []) {
    if (e && Math.abs(e.timestamp - mealTime) <= SAME_MOMENT_MS && e.bolusUnits > 0) {
      raw += e.bolusUnits;
      effective += e.bolusUnits * shareInWindow(e.timestamp, mealTime, endTime, actionHours);
    }
  }
  return raw > 0 ? effective / raw : 1;
}

export function sumAdditionalCarbs(carbs: readonly CarbEvent[] | null | undefined, mealTime: number, cutoff: number): number {
  let sum = 0;
  for (const c of carbs ?? []) {
    if (c && c.timestamp > mealTime && c.timestamp < cutoff) sum += c.grams;
  }
  return sum;
}

export function firstCarbAtOrAfter(carbs: readonly CarbEvent[] | null | undefined, fromTime: number): number | null {
  let earliest: number | null = null;
  for (const c of carbs ?? []) {
    if (c && c.timestamp >= fromTime && (earliest === null || c.timestamp < earliest)) earliest = c.timestamp;
  }
  return earliest;
}

export function sumAttachedCarbs(carbs: readonly CarbEvent[] | null | undefined, mealTime: number, endBound: number): number {
  let sum = 0;
  for (const c of carbs ?? []) {
    if (c && c.attached && c.timestamp > mealTime && c.timestamp < endBound) sum += c.grams;
  }
  return sum;
}

export function firstUnattachedCarbAfter(carbs: readonly CarbEvent[] | null | undefined, mealTime: number): number | null {
  let earliest: number | null = null;
  for (const c of carbs ?? []) {
    if (c && !c.attached && c.timestamp > mealTime && (earliest === null || c.timestamp < earliest)) earliest = c.timestamp;
  }
  return earliest;
}

/** Doses after the meal up to СК_отработка (endTime), each with its share from the activity table. */
export function collectSupplements(
  events: readonly InsulinEvent[] | null | undefined,
  mealTime: number,
  endTime: number,
  actionHours: number,
): Supplement[] {
  const out: Supplement[] = [];
  for (const e of events ?? []) {
    if (!e || e.bolusUnits === 0 || e.timestamp <= mealTime + SAME_MOMENT_MS || e.timestamp >= endTime) continue;
    const share = shareInWindow(e.timestamp, mealTime, endTime, actionHours);
    out.push({ doseUnits: e.bolusUnits, hoursToSplit: (endTime - e.timestamp) / HOUR_MS, effectiveUnits: e.bolusUnits * share, timestamp: e.timestamp });
  }
  return out;
}

/** Doses before the meal (a pre-meal подколка, the previous meal's) still acting in its window, each with its share. */
export function collectPriorDoses(
  events: readonly InsulinEvent[] | null | undefined,
  mealTime: number,
  endTime: number,
  actionHours: number,
): Supplement[] {
  const out: Supplement[] = [];
  if (!(actionHours > 0)) return out;
  const actionStart = mealTime - Math.round(actionHours * HOUR_MS);
  for (const e of events ?? []) {
    if (!e || e.bolusUnits <= 0 || e.timestamp >= mealTime - SAME_MOMENT_MS || e.timestamp <= actionStart) continue;
    const share = shareInWindow(e.timestamp, mealTime, endTime, actionHours);
    if (share > 0) {
      out.push({ doseUnits: e.bolusUnits, hoursToSplit: (mealTime - e.timestamp) / HOUR_MS, effectiveUnits: e.bolusUnits * share, timestamp: e.timestamp });
    }
  }
  return out;
}

/** Units from doses before the meal that acted inside its window — the sum of collectPriorDoses. */
export function residualPriorInsulin(
  events: readonly InsulinEvent[] | null | undefined,
  mealTime: number,
  endTime: number,
  actionHours: number,
): number {
  return collectPriorDoses(events, mealTime, endTime, actionHours).reduce((sum, d) => sum + d.effectiveUnits, 0);
}

/**
 * Average total daily bolus over the {@code days} whole days BEFORE the meal's day. Strict: NaN
 * unless EVERY one of those days has a bolus (a partial total ÷ N gave a misleading ФЧИ).
 */
export function averageDailyBolusBeforeDay(
  events: readonly InsulinEvent[] | null | undefined,
  mealDayStartMs: number,
  days: number,
): number {
  if (days <= 0) return NaN;
  const windowStart = mealDayStartMs - days * DAY_MS;
  const perDay = new Array<number>(days).fill(0);
  const dayHasBolus = new Array<boolean>(days).fill(false);
  for (const e of events ?? []) {
    if (!e) continue;
    if (e.timestamp >= windowStart && e.timestamp < mealDayStartMs) {
      const idx = Math.floor((e.timestamp - windowStart) / DAY_MS);
      if (idx >= 0 && idx < days) {
        perDay[idx] = (perDay[idx] ?? 0) + e.bolusUnits;
        if (e.bolusUnits > 0) dayHasBolus[idx] = true;
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < days; i++) {
    if (!dayHasBolus[i]) return NaN;
    sum += perDay[i] ?? 0;
  }
  return sum / days;
}
