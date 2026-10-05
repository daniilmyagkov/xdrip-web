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

/** Main bolus: every dose within ±windowMs of the meal (before counts the same as after). */
export function sumBolus(events: readonly InsulinEvent[] | null | undefined, mealTime: number, windowMs: number): number {
  let sum = 0;
  for (const e of events ?? []) {
    if (e && Math.abs(e.timestamp - mealTime) <= windowMs) sum += e.bolusUnits;
  }
  return sum;
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

/** Подколки after the main window, each weighted by the activity curve up to the СК_отработка mark. */
export function collectSupplements(
  events: readonly InsulinEvent[] | null | undefined,
  mealTime: number,
  mainWindowMs: number,
  endTime: number,
  nextMealTime: number | null,
  actionHours: number,
): Supplement[] {
  const out: Supplement[] = [];
  if (!events) return out;
  const actionMs = Math.round(Math.max(actionHours, 0) * HOUR_MS);
  const haveNext = nextMealTime !== null && nextMealTime > mealTime;
  const after = mealTime + mainWindowMs;
  const splitPoint = endTime;
  const suppEnd = haveNext ? Math.max(after, (nextMealTime as number) - mainWindowMs) : endTime;
  for (const e of events) {
    if (!e || e.bolusUnits === 0) continue;
    const withinBolus = Math.abs(e.timestamp - mealTime) <= mainWindowMs;
    const inSuppWindow = e.timestamp > after && e.timestamp < suppEnd;
    const taggedLate = e.attached && !withinBolus && e.timestamp > mealTime && e.timestamp < suppEnd;
    if (!inSuppWindow && !taggedLate) continue;
    const toSplit = Math.max(0, splitPoint - e.timestamp);
    const weight = actionMs > 0 ? actedFraction(toSplit / HOUR_MS, actionHours) : 0;
    out.push({ doseUnits: e.bolusUnits, hoursToSplit: toSplit / HOUR_MS, effectiveUnits: e.bolusUnits * weight });
  }
  return out;
}

/** Still-active part of doses given before the meal's own bolus window (previous meal / its подколки). */
export function residualPriorInsulin(
  events: readonly InsulinEvent[] | null | undefined,
  mealTime: number,
  actionHours: number,
  ownBolusFromMs: number,
): number {
  if (!events || !(actionHours > 0)) return 0;
  const windowStartMs = mealTime - Math.round(actionHours * HOUR_MS);
  let sum = 0;
  for (const e of events) {
    if (!e || e.bolusUnits <= 0) continue;
    if (e.timestamp >= ownBolusFromMs || e.timestamp <= windowStartMs) continue;
    const hoursAgo = (mealTime - e.timestamp) / HOUR_MS;
    const stillActive = remainingFraction(hoursAgo, actionHours);
    if (stillActive > 0) sum += e.bolusUnits * stillActive;
  }
  return sum;
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
