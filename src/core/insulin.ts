/**
 * Insulin activity curve and the rule-of-100 ISF — ports of InsulinActivityCurve.java and
 * InsulinSensitivity.java. Keep in lock-step with the Android app.
 */

/** 25 / 35 / 25 / 7 / 8 % of the dose over five equal parts of the action time (user-dictated). */
const PER_FIFTH = [0.25, 0.35, 0.25, 0.07, 0.08] as const;
const SEGMENTS = PER_FIFTH.length;
const CUMULATIVE: number[] = (() => {
  const out: number[] = [];
  let running = 0;
  for (const p of PER_FIFTH) {
    running += p;
    out.push(running);
  }
  return out;
})();

/** Fraction of a dose that has acted {@code hoursSinceInjection} after it, the curve stretched to {@code actionHours}. */
export function actedFraction(hoursSinceInjection: number, actionHours: number): number {
  if (Number.isNaN(hoursSinceInjection) || hoursSinceInjection <= 0 || !(actionHours > 0)) return 0;
  const progress = hoursSinceInjection / actionHours;
  if (progress >= 1) return 1;
  const scaled = progress * SEGMENTS;
  const seg = Math.floor(scaled);
  const into = scaled - seg;
  const before = seg === 0 ? 0 : (CUMULATIVE[seg - 1] ?? 0);
  return before + (PER_FIFTH[seg] ?? 0) * into;
}

export function remainingFraction(hoursSinceInjection: number, actionHours: number): number {
  return 1 - actedFraction(hoursSinceInjection, actionHours);
}

export const RULE_OF_100_CONSTANT = 100;
export const DEFAULT_AVERAGE_DAYS = 3;

/** ФЧИ by the rule of 100: 100 / total daily bolus. NaN when the total is unusable. */
export function isfByRuleOf100(totalDailyBolusUnits: number): number {
  if (!Number.isFinite(totalDailyBolusUnits) || totalDailyBolusUnits <= 0) return NaN;
  const isf = RULE_OF_100_CONSTANT / totalDailyBolusUnits;
  return isf > 0 && Number.isFinite(isf) ? isf : NaN;
}

export function averageDailyBolus(dailyBolusTotals: readonly number[] | null | undefined): number {
  if (!dailyBolusTotals || dailyBolusTotals.length === 0) return NaN;
  let sum = 0;
  let count = 0;
  for (const v of dailyBolusTotals) {
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return count === 0 ? NaN : sum / count;
}
