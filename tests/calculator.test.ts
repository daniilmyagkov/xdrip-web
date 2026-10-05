// Port of CarbRatioCalculatorTest.java — the same numbers must come out on the web as on Android.
import { describe, expect, it } from 'vitest';
import { calculate, correctionDoseUnits, inputWithBreadUnits, inputWithCarbGrams, type CarbRatioInput } from '../src/core/calculator';
import { averageDailyBolus, isfByRuleOf100 } from '../src/core/insulin';

const EPS = 6; // toBeCloseTo digits ≈ 1e-6
const addSupplement = (in_: CarbRatioInput, dose: number, hours: number, effective: number): CarbRatioInput => {
  in_.supplements.push({ doseUnits: dose, hoursToSplit: hours, effectiveUnits: effective });
  return in_;
};

describe('methodology worked examples', () => {
  it('example 1: СК 5.3 → 8.7, ФЧИ 10, доза 6, 7.09 ХЕ → УК 0.89', () => {
    const r = calculate(inputWithBreadUnits(5.3, 8.7, 6.0, 7.09, 10.0, 10.0, 'AUTO_RULE_OF_100'));
    expect(r.computed).toBe(true);
    expect(r.bgDeltaMmol).toBeCloseTo(3.4, EPS);
    expect(r.bgCorrectionUnits).toBeCloseTo(0.34, EPS);
    expect(r.doseDenominatorUnits).toBeCloseTo(6.34, EPS);
    expect(r.breadUnits).toBeCloseTo(7.09, EPS);
    expect(r.insulinPerBreadUnit).toBeCloseTo(0.89, EPS);
    expect(r.isfSource).toBe('AUTO_RULE_OF_100');
    expect(r.status).toBe('OK');
    expect(r.warnings.size).toBe(0);
  });

  it('example 2: СК 10 → 9, ФЧИ 3.5, доза 4, 43.6 г → 11.74 г на 1 ед', () => {
    const r = calculate(inputWithCarbGrams(10.0, 9.0, 4.0, 43.6, 10.0, 3.5, 'MANUAL'));
    expect(r.doseDenominatorUnits).toBeCloseTo(3.7143, 4);
    expect(r.carbGramsPerUnit).toBeCloseTo(11.74, EPS);
    expect(r.status).toBe('OK');
  });
});

describe('ФЧИ helpers', () => {
  it('rule of 100', () => {
    expect(isfByRuleOf100(40)).toBeCloseTo(2.5, EPS);
    expect(isfByRuleOf100(28.571428)).toBeCloseTo(3.5, 4);
    expect(isfByRuleOf100(0)).toBeNaN();
    expect(isfByRuleOf100(-5)).toBeNaN();
  });

  it('average daily bolus', () => {
    expect(averageDailyBolus([30, 34, 32])).toBeCloseTo(32, EPS);
    expect(averageDailyBolus([30, NaN, 34])).toBeCloseTo(32, EPS);
    expect(averageDailyBolus([])).toBeNaN();
  });
});

describe('correction dose', () => {
  it('above target is positive', () => expect(correctionDoseUnits(10, 6, 3.5)).toBeCloseTo(1.1429, 4));
  it('bad ISF is NaN', () => expect(correctionDoseUnits(10, 6, 0)).toBeNaN());
});

describe('validation / edge cases', () => {
  it('insufficient data when no carbs', () => {
    const r = calculate(inputWithCarbGrams(5.3, 8.7, 6.0, 0.0, 10.0, 10.0, 'MANUAL'));
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.computed).toBe(false);
    expect(r.missing.has('CARBS')).toBe(true);
    expect(r.insulinPerBreadUnit).toBeNaN();
  });

  it('insufficient data when ISF zero', () => {
    const r = calculate(inputWithCarbGrams(5.3, 8.7, 6.0, 60.0, 10.0, 0.0, 'MANUAL'));
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.missing.has('ISF')).toBe(true);
  });

  it('insufficient data when end reading missing', () => {
    const r = calculate(inputWithCarbGrams(5.3, NaN, 6.0, 60.0, 10.0, 10.0, 'MANUAL'));
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.missing.has('BG_END')).toBe(true);
  });

  it('no bolus still computes but warns', () => {
    const r = calculate(inputWithBreadUnits(5.3, 8.7, 0.0, 7.09, 10.0, 10.0, 'MANUAL'));
    expect(r.computed).toBe(true);
    expect(r.warnings.has('NO_BOLUS')).toBe(true);
    expect(r.status).toBe('WARNING');
    expect(r.insulinPerBreadUnit).toBeCloseTo(0.05, EPS);
  });

  it('atypical when result too high — the number is not hidden', () => {
    const r = calculate(inputWithBreadUnits(5.0, 20.0, 10.0, 1.0, 10.0, 3.0, 'MANUAL'));
    expect(r.computed).toBe(true);
    expect(r.status).toBe('ATYPICAL');
    expect(r.warnings.has('ATYPICAL_RESULT')).toBe(true);
    expect(r.insulinPerBreadUnit).toBeCloseTo(15.0, EPS);
  });

  it('atypical when denominator non-positive', () => {
    const r = calculate(inputWithCarbGrams(12.0, 5.0, 0.5, 40.0, 10.0, 3.0, 'MANUAL'));
    expect(r.doseDenominatorUnits).toBeLessThan(0);
    expect(r.warnings.has('NON_POSITIVE_DENOMINATOR')).toBe(true);
    expect(r.status).toBe('ATYPICAL');
  });
});

describe('supplemental injections (подколки)', () => {
  it('adds the precomputed effective units', () => {
    const r = calculate(addSupplement(inputWithCarbGrams(5.0, 8.0, 4.0, 60.0, 10.0, 2.0, 'MANUAL'), 2.0, 2.0, 0.8));
    expect(r.appliedSupplements).toHaveLength(1);
    expect(r.appliedSupplements[0]?.fraction).toBeCloseTo(0.4, EPS);
    expect(r.supplementalEffectiveUnits).toBeCloseTo(0.8, EPS);
    expect(r.effectiveBolusUnits).toBeCloseTo(4.8, EPS);
    expect(r.doseDenominatorUnits).toBeCloseTo(6.3, EPS);
    expect(r.insulinPerBreadUnit).toBeCloseTo(1.05, EPS);
  });

  it('multiple are summed', () => {
    const in_ = inputWithCarbGrams(5.0, 8.0, 4.0, 60.0, 10.0, 2.0, 'MANUAL');
    addSupplement(addSupplement(in_, 2.0, 2.0, 0.8), 1.0, 1.0, 0.75);
    const r = calculate(in_);
    expect(r.appliedSupplements).toHaveLength(2);
    expect(r.supplementalEffectiveUnits).toBeCloseTo(1.55, EPS);
    expect(r.effectiveBolusUnits).toBeCloseTo(5.55, EPS);
  });

  it('zero effective adds nothing', () => {
    const r = calculate(addSupplement(inputWithCarbGrams(5.0, 8.0, 4.0, 60.0, 10.0, 2.0, 'MANUAL'), 3.0, 5.0, 0.0));
    expect(r.supplementalEffectiveUnits).toBeCloseTo(0, EPS);
    expect(r.effectiveBolusUnits).toBeCloseTo(4.0, EPS);
  });

  it('ignored when not provided', () => {
    const r = calculate(inputWithCarbGrams(5.0, 8.0, 4.0, 60.0, 10.0, 2.0, 'MANUAL'));
    expect(r.supplementalEffectiveUnits).toBeCloseTo(0, EPS);
    expect(r.effectiveBolusUnits).toBeCloseTo(4.0, EPS);
  });

  it('additional carbs echoed into the result', () => {
    const in_ = inputWithCarbGrams(5.0, 8.0, 4.0, 70.0, 10.0, 2.0, 'MANUAL');
    in_.additionalCarbGrams = 10;
    const r = calculate(in_);
    expect(r.additionalCarbGrams).toBeCloseTo(10, EPS);
    expect(r.breadUnits).toBeCloseTo(7, EPS);
  });
});

describe('rounding', () => {
  it('two decimals HALF_UP like Java BigDecimal: 1.005 → 1.01', () => {
    const r = calculate(inputWithBreadUnits(6.0, 6.0, 1.005, 1.0, 10.0, 10.0, 'MANUAL'));
    expect(r.insulinPerBreadUnit).toBeCloseTo(1.01, 9);
    expect(r.insulinPerBreadUnitRaw).toBeCloseTo(1.005, EPS);
  });
});
