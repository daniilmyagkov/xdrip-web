/** Breakfast / lunch / dinner by local time — port of UkMealClassifier.java. */
import { parseMealType } from './notes';

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER';

export const DEFAULT_BREAKFAST_HOUR = 6;
export const DEFAULT_LUNCH_HOUR = 12;
export const DEFAULT_DINNER_HOUR = 18;

export interface MealHours {
  breakfast: number;
  lunch: number;
  dinner: number;
}

export const DEFAULT_MEAL_HOURS: MealHours = {
  breakfast: DEFAULT_BREAKFAST_HOUR,
  lunch: DEFAULT_LUNCH_HOUR,
  dinner: DEFAULT_DINNER_HOUR,
};

const clampHour = (h: number, fallback: number): number => (Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback);

/**
 * Three hour boundaries split the day into three arcs (wrapping past midnight): the meal belongs
 * to the type whose boundary is the last one before it. Anything before the earliest boundary
 * (a 02:00 snack) belongs to the latest boundary's type.
 */
export function classifyHour(hourOfDay: number, breakfastHour: number, lunchHour: number, dinnerHour: number): MealType {
  const b = clampHour(breakfastHour, DEFAULT_BREAKFAST_HOUR);
  const l = clampHour(lunchHour, DEFAULT_LUNCH_HOUR);
  const d = clampHour(dinnerHour, DEFAULT_DINNER_HOUR);
  const bounds: Array<[number, number]> = [
    [b, 0],
    [l, 1],
    [d, 2],
  ];
  let bestIdx = -1;
  let bestBound = -1;
  for (const [bound, idx] of bounds) {
    if (bound <= hourOfDay && bound > bestBound) {
      bestBound = bound;
      bestIdx = idx;
    }
  }
  if (bestIdx < 0) {
    let maxBound = -1;
    for (const [bound, idx] of bounds) {
      if (bound > maxBound) {
        maxBound = bound;
        bestIdx = idx;
      }
    }
  }
  return bestIdx === 0 ? 'BREAKFAST' : bestIdx === 1 ? 'LUNCH' : 'DINNER';
}

export function classifyTime(mealTimeMs: number, hours: MealHours = DEFAULT_MEAL_HOURS): MealType {
  const d = new Date(mealTimeMs);
  return classifyHour(d.getHours() + d.getMinutes() / 60, hours.breakfast, hours.lunch, hours.dinner);
}

/** A type pinned in the note (#завтрак/#обед/#ужин) wins over the time of day. */
export function classify(mealTimeMs: number, notes: string | null | undefined, hours: MealHours = DEFAULT_MEAL_HOURS): MealType {
  return parseMealType(notes) ?? classifyTime(mealTimeMs, hours);
}

export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  BREAKFAST: 'Завтрак',
  LUNCH: 'Обед',
  DINNER: 'Ужин',
};
