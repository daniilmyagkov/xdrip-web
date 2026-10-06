/**
 * Carb-ratio settings — same defaults, bounds and meaning as UkSettings.java on Android.
 * The web app keeps its own copy (localStorage); the defaults match a fresh Android install.
 */
import { HOUR_MS, MINUTE_MS } from './units';
import { DEFAULT_MEAL_HOURS, type MealHours } from './classifier';

export interface UkSettings {
  gramsPerBreadUnit: number;
  bolusWindowMin: number;
  workoutHours: number;
  isfMethod: 'average' | 'last_day';
  isfAvgDays: number;
  mealHours: MealHours;
  trendDays: number;
  targetPreMealMin: number;
  targetPreMealMax: number;
}

export const DEFAULT_SETTINGS: UkSettings = {
  gramsPerBreadUnit: 10,
  bolusWindowMin: 30,
  workoutHours: 5,
  isfMethod: 'average',
  isfAvgDays: 3,
  mealHours: { ...DEFAULT_MEAL_HOURS },
  trendDays: 14,
  targetPreMealMin: 4,
  targetPreMealMax: 8,
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const positiveOr = (v: number, fallback: number): number => (Number.isFinite(v) && v > 0 ? v : fallback);

/** Resolved, clamped values the calculation uses (mirrors the UkSettings getters). */
export interface Effective {
  gramsPerBreadUnit: number;
  bolusWindowMs: number;
  workoutMs: number;
  isfDays: number;
  mealHours: MealHours;
  trendDays: number;
  defaultTargetMmol: number;
}

export function effective(s: UkSettings = DEFAULT_SETTINGS): Effective {
  const isfDays =
    s.isfMethod === 'last_day' ? 1 : Math.max(1, Math.round(clamp(positiveOr(s.isfAvgDays, 3), 1, 30)));
  return {
    gramsPerBreadUnit: clamp(positiveOr(s.gramsPerBreadUnit, 10), 1, 100),
    bolusWindowMs: Math.round(clamp(positiveOr(s.bolusWindowMin, 30), 1, 12 * 60) * MINUTE_MS),
    workoutMs: Math.round(clamp(positiveOr(s.workoutHours, 5), 0.5, 24) * HOUR_MS),
    isfDays,
    mealHours: s.mealHours,
    trendDays: Number.isFinite(s.trendDays) ? Math.round(clamp(s.trendDays, 1, 90)) : 14,
    defaultTargetMmol: (positiveOr(s.targetPreMealMin, 4) + positiveOr(s.targetPreMealMax, 8)) / 2,
  };
}
