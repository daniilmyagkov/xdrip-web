/**
 * Everything needed to compute one meal's УК, gathered from in-memory glucose + entries — port of
 * CarbRatioDataCollector.pull(). The Android version queries its database; here the caller passes
 * the loaded Nightscout data (it must cover the meal's day minus the ФЧИ days, up to now).
 */
import { calculate, inputWithCarbGrams, type CarbRatioResult, type Supplement } from './calculator';
import { isfByRuleOf100 } from './insulin';
import { parseBgStart, parseIsf, pinnedIsf } from './notes';
import { Attachments, previousMealIsf } from './roles';
import {
  averageDailyBolusBeforeDay,
  collectSupplements,
  firstUnattachedCarbAfter,
  pickNearest,
  pickStart,
  residualPriorInsulin,
  sumAttachedCarbs,
  sumBolus,
  targetEndTime,
  type BgPoint,
  type CarbEvent,
  type InsulinEvent,
} from './selection';
import type { Effective } from './settings';
import { bolusUnitsOf, type Treatment } from './treatment';
import { DAY_MS, HOUR_MS, localMidnight, MINUTE_MS } from './units';

export const START_LOOKBACK_MS = 40 * MINUTE_MS;
export const START_FORWARD_TOLERANCE_MS = 5 * MINUTE_MS;
export const END_RADIUS_MS = 12 * 60 * MINUTE_MS;

export interface Pulled {
  bgStartMmol: number;
  bgEndMmol: number;
  bolusUnits: number;
  carbGrams: number;
  additionalCarbGrams: number;
  supplements: Supplement[];
  residualPriorInsulinUnits: number;
  isfMmolPerUnit: number;
  windowComplete: boolean;
  expectedEndTime: number;
}

export interface Data {
  /** Glucose readings (any order), mmol/L. */
  readings: readonly BgPoint[];
  /** Food / insulin / note entries (any order). */
  entries: readonly Treatment[];
}

const inRange = (ts: number, from: number, to: number): boolean => ts >= from && ts <= to;

function carbEventsBetween(data: Data, from: number, to: number, attachments: Attachments): CarbEvent[] {
  return data.entries
    .filter((t) => t.carbs > 0 && inRange(t.timestamp, from, to) && !attachments.isNotMeal(t))
    .map((t) => ({ timestamp: t.timestamp, grams: t.carbs, attached: attachments.isAttached(t) }));
}

function bolusEvents(data: Data, from: number, to: number, attachments: Attachments | null): InsulinEvent[] {
  const out: InsulinEvent[] = [];
  for (const t of data.entries) {
    if (!inRange(t.timestamp, from, to)) continue;
    const bolus = bolusUnitsOf(t);
    if (bolus !== 0) out.push({ timestamp: t.timestamp, bolusUnits: bolus, attached: attachments ? attachments.isAttached(t) : false });
  }
  return out;
}

function readingsBetween(data: Data, from: number, to: number): BgPoint[] {
  return data.readings
    .filter((p) => inRange(p.timestamp, from, to) && p.mmol > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** The entry nearest {@code ts} within {@code accuracyMs} (Treatments.byTimestamp). */
export function byTimestamp(entries: readonly Treatment[], ts: number, accuracyMs: number): Treatment | null {
  let best: Treatment | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of entries) {
    const d = Math.abs(t.timestamp - ts);
    if (d <= accuracyMs && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

export function pull(data: Data, mealTime: number, mealCarbGrams: number, now: number, s: Effective): Pulled {
  const { bolusWindowMs, workoutMs } = s;
  const attachments = Attachments.resolve(data.entries, workoutMs);

  // доедания are what the roles say, inside the отработка window (no separate доедание window)
  const carbScanMs = workoutMs + MINUTE_MS;
  const carbsAfter = carbEventsBetween(data, mealTime + 1, mealTime + carbScanMs, attachments);
  const additionalCarbGrams = sumAttachedCarbs(carbsAfter, mealTime, mealTime + carbScanMs);

  const nextMealTime = firstUnattachedCarbAfter(carbsAfter, mealTime);
  const endTime = targetEndTime(mealTime, workoutMs, nextMealTime);
  const endTarget = Math.min(endTime, now);

  const points = readingsBetween(data, mealTime - START_LOOKBACK_MS - MINUTE_MS, now + MINUTE_MS);
  const start = pickStart(points, mealTime, START_FORWARD_TOLERANCE_MS, START_LOOKBACK_MS);
  const end = pickNearest(points, endTarget, END_RADIUS_MS, mealTime + 30 * MINUTE_MS, now);

  const days = Math.max(s.isfDays, 1);
  const mealDayStart = localMidnight(mealTime);
  const isfEvents = bolusEvents(data, mealDayStart - days * DAY_MS - MINUTE_MS, mealDayStart + MINUTE_MS, null);
  const isf = isfByRuleOf100(averageDailyBolusBeforeDay(isfEvents, mealDayStart, days));

  const insulinLookback = Math.max(bolusWindowMs, workoutMs);
  const windowEvents = bolusEvents(data, mealTime - insulinLookback - MINUTE_MS, endTarget + MINUTE_MS, attachments);

  let bgStartMmol = start ? start.mmol : NaN;
  const mealEntry = byTimestamp(data.entries, mealTime, 6 * MINUTE_MS);
  if (mealEntry) {
    const pinned = parseBgStart(mealEntry.notes);
    if (Number.isFinite(pinned) && pinned > 0) bgStartMmol = pinned;
  }

  return {
    bgStartMmol,
    bgEndMmol: end ? end.mmol : NaN,
    bolusUnits: sumBolus(windowEvents, mealTime, bolusWindowMs),
    carbGrams: mealCarbGrams + additionalCarbGrams,
    additionalCarbGrams,
    supplements: collectSupplements(windowEvents, mealTime, bolusWindowMs, endTime, nextMealTime, workoutMs / HOUR_MS),
    residualPriorInsulinUnits: residualPriorInsulin(windowEvents, mealTime, workoutMs / HOUR_MS, mealTime - bolusWindowMs),
    isfMmolPerUnit: isf,
    windowComplete: now >= endTime,
    expectedEndTime: endTime,
  };
}

export type IsfOrigin = 'PINNED' | 'RULE_OF_100' | 'NOTE' | 'PREVIOUS_MEAL' | 'NONE';

/**
 * ФЧИ for a meal, same priority as the Android auto-compute worker: a value pinned in the meal's
 * note → the rule of 100 → any ФЧИ noted on the meal → the previous meal's ФЧИ.
 */
export function isfForMeal(data: Data, meal: Treatment, pulled: Pulled): { isf: number; origin: IsfOrigin } {
  const pinned = pinnedIsf(meal.notes);
  if (Number.isFinite(pinned)) return { isf: pinned, origin: 'PINNED' };
  if (Number.isFinite(pulled.isfMmolPerUnit)) return { isf: pulled.isfMmolPerUnit, origin: 'RULE_OF_100' };
  const noted = parseIsf(meal.notes);
  if (Number.isFinite(noted)) return { isf: noted, origin: 'NOTE' };
  const prev = previousMealIsf(data.entries, meal.timestamp);
  if (Number.isFinite(prev)) return { isf: prev, origin: 'PREVIOUS_MEAL' };
  return { isf: NaN, origin: 'NONE' };
}

export interface MealEstimate {
  pulled: Pulled;
  result: CarbRatioResult;
  isfOrigin: IsfOrigin;
}

/** Live УК estimate for a meal (what the Android meal card shows). */
export function estimateMeal(data: Data, meal: Treatment, now: number, s: Effective): MealEstimate {
  const pulled = pull(data, meal.timestamp, meal.carbs, now, s);
  const { isf, origin } = isfForMeal(data, meal, pulled);
  const input = inputWithCarbGrams(
    pulled.bgStartMmol,
    pulled.bgEndMmol,
    pulled.bolusUnits,
    pulled.carbGrams,
    s.gramsPerBreadUnit,
    isf,
    origin === 'RULE_OF_100' ? 'AUTO_RULE_OF_100' : 'MANUAL',
  );
  input.additionalCarbGrams = pulled.additionalCarbGrams;
  input.supplements.push(...pulled.supplements);
  input.residualPriorInsulinUnits = pulled.residualPriorInsulinUnits;
  return { pulled, result: calculate(input), isfOrigin: origin };
}
