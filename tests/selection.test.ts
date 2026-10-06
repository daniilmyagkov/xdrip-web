// Port of CarbRatioDataSelectionTest.java.
import { describe, expect, it } from 'vitest';
import { actedFraction, remainingFraction } from '../src/core/insulin';
import {
  averageDailyBolusBeforeDay,
  bolusShare,
  collectPriorDoses,
  collectSupplements,
  SAME_MOMENT_MS,
  shareInWindow,
  firstCarbAtOrAfter,
  isReadyToCompute,
  pickNearest,
  pickStart,
  residualPriorInsulin,
  sumAdditionalCarbs,
  sumBolus,
  targetEndTime,
  type BgPoint,
  type CarbEvent,
  type InsulinEvent,
} from '../src/core/selection';

const MIN = 60_000;
const HOUR = 60 * MIN;
const MEAL = 1_000_000_000_000;
const D9 = 9;
const bg = (timestamp: number, mmol: number): BgPoint => ({ timestamp, mmol });
const ins = (timestamp: number, bolusUnits: number): InsulinEvent => ({ timestamp, bolusUnits, attached: false });
const carb = (timestamp: number, grams: number): CarbEvent => ({ timestamp, grams, attached: false });
const NEG = Number.NEGATIVE_INFINITY;

describe('pickStart / end reading', () => {
  it('takes the closest reading before the meal', () => {
    const s = pickStart([bg(MEAL - 40 * MIN, 6), bg(MEAL - 8 * MIN, 5.3), bg(MEAL + 20 * MIN, 9.1)], MEAL, 5 * MIN, 30 * MIN);
    expect(s?.mmol).toBeCloseTo(5.3, D9);
  });
  it('null when nothing within lookback', () => {
    expect(pickStart([bg(MEAL - 90 * MIN, 6)], MEAL, 5 * MIN, 30 * MIN)).toBeNull();
  });
  it('end: takes the reading just past the mark when opened late, ignores the future', () => {
    const endTime = MEAL + 210 * MIN;
    const now = endTime + 25 * MIN;
    const e = pickNearest([bg(endTime - 40 * MIN, 7.5), bg(endTime + 20 * MIN, 8.4), bg(now + 5 * MIN, 8.9)], endTime, 3 * HOUR, NEG, now);
    expect(e?.mmol).toBeCloseTo(8.4, D9);
  });
  it('end: recovers after a CGM gap around the mark', () => {
    const endTime = MEAL + 210 * MIN;
    const now = MEAL + 8 * HOUR;
    const e = pickNearest(
      [bg(MEAL - 5 * MIN, 5.3), bg(MEAL + 50 * MIN, 9.1), bg(MEAL + 6 * HOUR, 7.8), bg(now - 3 * MIN, 6.4)],
      endTime,
      12 * HOUR,
      MEAL + 30 * MIN,
      now,
    );
    expect(e?.mmol).toBeCloseTo(7.8, D9);
  });
  it('end: excludes readings before / right after the meal', () => {
    const e = pickNearest([bg(MEAL - 10 * MIN, 5), bg(MEAL + 10 * MIN, 7)], MEAL + 210 * MIN, 12 * HOUR, MEAL + 30 * MIN, MEAL + 5 * HOUR);
    expect(e).toBeNull();
  });
});

describe('targetEndTime / readiness', () => {
  it('uses the next meal when it comes first', () => {
    expect(targetEndTime(MEAL, 5 * HOUR, MEAL + 3 * HOUR)).toBe(MEAL + 3 * HOUR);
    expect(targetEndTime(MEAL, 5 * HOUR, MEAL + 7 * HOUR)).toBe(MEAL + 5 * HOUR);
    expect(targetEndTime(MEAL, 5 * HOUR, null)).toBe(MEAL + 5 * HOUR);
  });
  it('readiness reflects elapsed time', () => {
    expect(isReadyToCompute(MEAL, 5 * HOUR, null, MEAL + 4 * HOUR)).toBe(false);
    expect(isReadyToCompute(MEAL, 5 * HOUR, null, MEAL + 5 * HOUR)).toBe(true);
    expect(isReadyToCompute(MEAL, 5 * HOUR, MEAL + 2 * HOUR, MEAL + 150 * MIN)).toBe(true);
  });
});

describe('bolus sums', () => {
  it("is only the dose at the meal itself", () => {
    expect(sumBolus([ins(MEAL - 20 * MIN, 2), ins(MEAL, 19.5), ins(MEAL + MIN, 1), ins(MEAL + 25 * MIN, 3)], MEAL)).toBeCloseTo(20.5, D9);
  });
});

describe('every dose by the 5 h activity table', () => {
  const end = MEAL + 5 * HOUR;
  it('follows the table', () => {
    expect(shareInWindow(MEAL, MEAL, end, 5)).toBeCloseTo(1, D9);
    expect(shareInWindow(MEAL - 15 * MIN, MEAL, end, 5)).toBeCloseTo(0.9375, D9);
    expect(shareInWindow(MEAL - 40 * MIN, MEAL, end, 5)).toBeCloseTo(1 - 0.25 * (40 / 60), D9);
    expect(shareInWindow(MEAL + 2 * HOUR, MEAL, end, 5)).toBeCloseTo(0.85, D9);
    expect(shareInWindow(end, MEAL, end, 5)).toBe(0);
    expect(shareInWindow(MEAL - 5 * HOUR, MEAL, end, 5)).toBe(0);
    expect(shareInWindow(MEAL, MEAL, end, 0)).toBe(0);
  });
  it('cuts the bolus share when the next meal ends the window early', () => {
    expect(bolusShare([ins(MEAL, 10)], MEAL, MEAL + 5 * HOUR, 5)).toBeCloseTo(1, D9);
    expect(bolusShare([ins(MEAL, 10)], MEAL, MEAL + 3 * HOUR, 5)).toBeCloseTo(0.85, D9);
    expect(bolusShare([], MEAL, MEAL + HOUR, 5)).toBe(1);
  });
});

describe('ФЧИ: whole days before the meal day', () => {
  const dayStart = MEAL;
  it('matches the spreadsheet rule', () => {
    const ev = [ins(dayStart - HOUR, 27.5), ins(dayStart - 26 * HOUR, 21.3), ins(dayStart - 50 * HOUR, 19.25), ins(dayStart - 80 * HOUR, 99), ins(dayStart + 2 * HOUR, 5)];
    expect(averageDailyBolusBeforeDay(ev, dayStart, 3)).toBeCloseTo((27.5 + 21.3 + 19.25) / 3, D9);
  });
  it('NaN with no history', () => expect(averageDailyBolusBeforeDay([], MEAL, 3)).toBeNaN());
  it('NaN when any day has no bolus', () => {
    expect(averageDailyBolusBeforeDay([ins(dayStart - HOUR, 20), ins(dayStart - 50 * HOUR, 18)], dayStart, 3)).toBeNaN();
  });
  it('last day only', () => {
    expect(averageDailyBolusBeforeDay([ins(dayStart - 2 * HOUR, 12), ins(dayStart - 10 * HOUR, 8), ins(dayStart - 30 * HOUR, 40)], dayStart, 1)).toBeCloseTo(20, D9);
  });
});

describe('insulin injected before the meal', () => {
  it('a pre-meal подколка counts by the table', () => {
    const prior = collectPriorDoses([ins(MEAL - 40 * MIN, 2)], MEAL, MEAL + 5 * HOUR, 5);
    expect(prior).toHaveLength(1);
    expect(prior[0]?.timestamp).toBe(MEAL - 40 * MIN);
    expect(prior[0]?.effectiveUnits).toBeCloseTo(2 * (1 - 0.25 * (40 / 60)), D9);
  });
  it('decays along the activity curve', () => {
    expect(residualPriorInsulin([ins(MEAL - 105 * MIN, 6)], MEAL, MEAL + 210 * MIN, 3.5)).toBeCloseTo(6 * remainingFraction(1.75, 3.5), D9);
  });
  it('zero for a dose older than the action time', () => {
    expect(residualPriorInsulin([ins(MEAL - 4 * HOUR, 8), ins(MEAL - 6 * HOUR, 8)], MEAL, MEAL + 210 * MIN, 3.5)).toBeCloseTo(0, D9);
  });
  it("skips the meal's own bolus", () => {
    expect(residualPriorInsulin([ins(MEAL, 5), ins(MEAL - 2 * HOUR, 4)], MEAL, MEAL + 210 * MIN, 3.5)).toBeCloseTo(4 * remainingFraction(2, 3.5), 6);
  });
  it('zero when action time is not positive', () => expect(residualPriorInsulin([ins(MEAL - HOUR, 5)], MEAL, MEAL + HOUR, 0)).toBe(0));
});

describe('доедания', () => {
  it('sumAdditionalCarbs counts only entries inside the window', () => {
    expect(sumAdditionalCarbs([carb(MEAL + 30 * MIN, 15), carb(MEAL + 100 * MIN, 10), carb(MEAL + 3 * HOUR, 60)], MEAL, MEAL + 120 * MIN)).toBeCloseTo(25, D9);
  });
  it('firstCarbAtOrAfter finds the next meal', () => {
    const c = [carb(MEAL + 30 * MIN, 15), carb(MEAL + 3 * HOUR, 60), carb(MEAL + 5 * HOUR, 55)];
    expect(firstCarbAtOrAfter(c, MEAL + 120 * MIN)).toBe(MEAL + 3 * HOUR);
    expect(firstCarbAtOrAfter(c, MEAL + 6 * HOUR)).toBeNull();
  });
});

describe('подколки', () => {
  it('weights by time to the observation end', () => {
    const s = collectSupplements([ins(MEAL, 6), ins(MEAL + 20 * MIN, 1.5), ins(MEAL + 2 * HOUR, 2), ins(MEAL + 5 * HOUR, 1)], MEAL, MEAL + 5 * HOUR, 5);
    expect(s).toHaveLength(2);
    expect(s[0]?.effectiveUnits).toBeCloseTo(1.5 * actedFraction(4 + 40 / 60, 5), D9);
    expect(s[1]?.doseUnits).toBeCloseTo(2, D9);
    expect(s[1]?.hoursToSplit).toBeCloseTo(3, D9);
    expect(s[1]?.effectiveUnits).toBeCloseTo(1.7, D9);
  });
  it('a dose between two meals is split without loss or double counting', () => {
    const mealB = MEAL + 4 * HOUR;
    const ev = [ins(MEAL, 6), ins(MEAL + 3 * HOUR, 2), ins(mealB, 7)];
    const forA = collectSupplements(ev, MEAL, mealB, 4);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.effectiveUnits).toBeCloseTo(2 * actedFraction(1, 4), D9);
    const forB = residualPriorInsulin(ev, mealB, mealB + 4 * HOUR, 4);
    expect(forB).toBeCloseTo(2 * remainingFraction(1, 4), D9);
    expect((forA[0]?.effectiveUnits ?? 0) + forB).toBeCloseTo(2, D9);
  });
  it("a pre-bolus for the next meal is split the same way", () => {
    const mealB = MEAL + 4 * HOUR;
    const ev = [ins(mealB - 15 * MIN, 2)];
    const forA = collectSupplements(ev, MEAL, mealB, 4);
    const forB = residualPriorInsulin(ev, mealB, mealB + 4 * HOUR, 4);
    expect(forA[0]?.effectiveUnits).toBeCloseTo(2 * actedFraction(0.25, 4), D9);
    expect((forA[0]?.effectiveUnits ?? 0) + forB).toBeCloseTo(2, D9);
  });
  it('the same-moment margin matches Android', () => expect(SAME_MOMENT_MS).toBe(2 * MIN));
});
