/**
 * The carb-ratio (УК) formula — port of CarbRatioInput / CarbRatioResult / CarbRatioCalculator /
 * ForwardDose. УК = ((СК_отработка − СК_старт) / ФЧИ + доза) / ХЕ.
 */
import { roundHalfUp } from './units';

export const DEFAULT_GRAMS_PER_BREAD_UNIT = 10;
export const MIN_PLAUSIBLE_UK = 0;
export const MAX_PLAUSIBLE_UK = 10;

export type Status = 'OK' | 'WARNING' | 'ATYPICAL' | 'INSUFFICIENT_DATA';
export type IsfSource = 'AUTO_RULE_OF_100' | 'MANUAL';
export type Warning = 'NO_BOLUS' | 'NON_POSITIVE_DENOMINATOR' | 'ATYPICAL_RESULT';
export type Missing = 'BG_START' | 'BG_END' | 'ISF' | 'CARBS' | 'GRAMS_PER_BREAD_UNIT';

/** A подколка: its dose, hours from injection to the СК_отработка mark, and the units counted for this meal. */
export interface Supplement {
  doseUnits: number;
  hoursToSplit: number;
  effectiveUnits: number;
}

export interface CarbRatioInput {
  bgStartMmol: number;
  bgEndMmol: number;
  bolusDoseUnits: number;
  carbGrams: number;
  gramsPerBreadUnit: number;
  isfMmolPerUnit: number;
  isfSource: IsfSource;
  supplements: Supplement[];
  additionalCarbGrams: number;
  residualPriorInsulinUnits: number;
}

export interface AppliedSupplement {
  doseUnits: number;
  hoursToEnd: number;
  fraction: number;
  effectiveUnits: number;
}

export interface CarbRatioResult {
  status: Status;
  computed: boolean;
  missing: Set<Missing>;
  warnings: Set<Warning>;
  insulinPerBreadUnit: number;
  carbGramsPerUnit: number;
  insulinPerBreadUnitRaw: number;
  carbGramsPerUnitRaw: number;
  isfUsedMmolPerUnit: number;
  isfSource: IsfSource;
  bgDeltaMmol: number;
  bgCorrectionUnits: number;
  effectiveBolusUnits: number;
  supplementalEffectiveUnits: number;
  residualPriorInsulinUnits: number;
  appliedSupplements: AppliedSupplement[];
  additionalCarbGrams: number;
  doseDenominatorUnits: number;
  breadUnits: number;
}

export function emptyInput(): CarbRatioInput {
  return {
    bgStartMmol: NaN,
    bgEndMmol: NaN,
    bolusDoseUnits: NaN,
    carbGrams: NaN,
    gramsPerBreadUnit: DEFAULT_GRAMS_PER_BREAD_UNIT,
    isfMmolPerUnit: NaN,
    isfSource: 'MANUAL',
    supplements: [],
    additionalCarbGrams: 0,
    residualPriorInsulinUnits: 0,
  };
}

export function inputWithCarbGrams(
  bgStartMmol: number,
  bgEndMmol: number,
  bolusDoseUnits: number,
  carbGrams: number,
  gramsPerBreadUnit: number,
  isfMmolPerUnit: number,
  isfSource: IsfSource,
): CarbRatioInput {
  return { ...emptyInput(), bgStartMmol, bgEndMmol, bolusDoseUnits, carbGrams, gramsPerBreadUnit, isfMmolPerUnit, isfSource };
}

export function inputWithBreadUnits(
  bgStartMmol: number,
  bgEndMmol: number,
  bolusDoseUnits: number,
  breadUnits: number,
  gramsPerBreadUnit: number,
  isfMmolPerUnit: number,
  isfSource: IsfSource,
): CarbRatioInput {
  const grams = Number.isNaN(breadUnits) || Number.isNaN(gramsPerBreadUnit) ? NaN : breadUnits * gramsPerBreadUnit;
  return inputWithCarbGrams(bgStartMmol, bgEndMmol, bolusDoseUnits, grams, gramsPerBreadUnit, isfMmolPerUnit, isfSource);
}

function emptyResult(isfSource: IsfSource, isf: number): CarbRatioResult {
  return {
    status: 'INSUFFICIENT_DATA',
    computed: false,
    missing: new Set(),
    warnings: new Set(),
    insulinPerBreadUnit: NaN,
    carbGramsPerUnit: NaN,
    insulinPerBreadUnitRaw: NaN,
    carbGramsPerUnitRaw: NaN,
    isfUsedMmolPerUnit: isf,
    isfSource,
    bgDeltaMmol: NaN,
    bgCorrectionUnits: NaN,
    effectiveBolusUnits: NaN,
    supplementalEffectiveUnits: 0,
    residualPriorInsulinUnits: 0,
    appliedSupplements: [],
    additionalCarbGrams: 0,
    doseDenominatorUnits: NaN,
    breadUnits: NaN,
  };
}

/** Rule: a "computed" result never carries a non-finite number. */
export function calculate(input: CarbRatioInput): CarbRatioResult {
  const r = emptyResult(input.isfSource, input.isfMmolPerUnit);

  if (!Number.isFinite(input.bgStartMmol)) r.missing.add('BG_START');
  if (!Number.isFinite(input.bgEndMmol)) r.missing.add('BG_END');
  if (!(input.isfMmolPerUnit > 0) || !Number.isFinite(input.isfMmolPerUnit)) r.missing.add('ISF');
  if (!(input.carbGrams > 0) || !Number.isFinite(input.carbGrams)) r.missing.add('CARBS');
  if (!(input.gramsPerBreadUnit > 0) || !Number.isFinite(input.gramsPerBreadUnit)) r.missing.add('GRAMS_PER_BREAD_UNIT');
  if (r.missing.size > 0) return r;

  const typedBolus = Number.isFinite(input.bolusDoseUnits) ? input.bolusDoseUnits : 0;

  let supplementalEffective = 0;
  for (const s of input.supplements) {
    if (!s || !Number.isFinite(s.doseUnits) || s.doseUnits === 0 || !Number.isFinite(s.effectiveUnits)) continue;
    supplementalEffective += s.effectiveUnits;
    const fraction = s.doseUnits !== 0 ? s.effectiveUnits / s.doseUnits : 0;
    r.appliedSupplements.push({ doseUnits: s.doseUnits, hoursToEnd: s.hoursToSplit, fraction, effectiveUnits: s.effectiveUnits });
  }
  r.supplementalEffectiveUnits = supplementalEffective;
  r.additionalCarbGrams = input.additionalCarbGrams;

  const residualPrior =
    Number.isFinite(input.residualPriorInsulinUnits) && input.residualPriorInsulinUnits > 0 ? input.residualPriorInsulinUnits : 0;
  r.residualPriorInsulinUnits = residualPrior;

  const bolus = typedBolus + supplementalEffective + residualPrior;
  r.effectiveBolusUnits = bolus;
  r.bgDeltaMmol = input.bgEndMmol - input.bgStartMmol;
  r.bgCorrectionUnits = r.bgDeltaMmol / input.isfMmolPerUnit;
  r.doseDenominatorUnits = r.bgCorrectionUnits + bolus;
  r.breadUnits = input.carbGrams / input.gramsPerBreadUnit;
  r.insulinPerBreadUnitRaw = r.doseDenominatorUnits / r.breadUnits;
  r.carbGramsPerUnitRaw = r.doseDenominatorUnits !== 0 ? input.carbGrams / r.doseDenominatorUnits : NaN;

  if (!Number.isFinite(r.insulinPerBreadUnitRaw) || !Number.isFinite(r.breadUnits) || !Number.isFinite(r.doseDenominatorUnits)) {
    r.missing.add('CARBS');
    r.status = 'INSUFFICIENT_DATA';
    r.computed = false;
    return r;
  }

  r.insulinPerBreadUnit = roundHalfUp(r.insulinPerBreadUnitRaw);
  r.carbGramsPerUnit = roundHalfUp(r.carbGramsPerUnitRaw);
  r.computed = true;

  if (bolus === 0) r.warnings.add('NO_BOLUS');
  let atypical = false;
  if (r.doseDenominatorUnits <= 0) {
    r.warnings.add('NON_POSITIVE_DENOMINATOR');
    atypical = true;
  }
  if (r.insulinPerBreadUnitRaw < MIN_PLAUSIBLE_UK || r.insulinPerBreadUnitRaw > MAX_PLAUSIBLE_UK) {
    r.warnings.add('ATYPICAL_RESULT');
    atypical = true;
  }
  r.status = atypical ? 'ATYPICAL' : r.warnings.size > 0 ? 'WARNING' : 'OK';
  return r;
}

/** (СК_старт − цель) / ФЧИ; NaN when any input is unusable. */
export function correctionDoseUnits(bgStartMmol: number, targetBgMmol: number, isfMmolPerUnit: number): number {
  if (!(isfMmolPerUnit > 0) || !Number.isFinite(isfMmolPerUnit) || !Number.isFinite(bgStartMmol) || !Number.isFinite(targetBgMmol)) {
    return NaN;
  }
  const dose = (bgStartMmol - targetBgMmol) / isfMmolPerUnit;
  return Number.isFinite(dose) ? dose : NaN;
}

export interface ForwardDoseResult {
  computed: boolean;
  needsCarbRatio: boolean;
  needsBreadUnits: boolean;
  needsIsf: boolean;
  needsCurrentBg: boolean;
  mealBolusUnits: number;
  correctionUnits: number;
  totalUnits: number;
  totalClampedToZero: boolean;
}

/** «Доза перед едой»: болюс = ХЕ × УК, коррекция = (СК − цель) / ФЧИ, итого (never below 0). */
export function forwardDose(
  currentBgMmol: number,
  targetBgMmol: number,
  isfMmolPerUnit: number,
  breadUnits: number,
  carbRatioInsulinPerBreadUnit: number,
): ForwardDoseResult {
  const r: ForwardDoseResult = {
    computed: false,
    needsCarbRatio: !(carbRatioInsulinPerBreadUnit > 0) || !Number.isFinite(carbRatioInsulinPerBreadUnit),
    needsBreadUnits: !(breadUnits > 0) || !Number.isFinite(breadUnits),
    needsIsf: !(isfMmolPerUnit > 0) || !Number.isFinite(isfMmolPerUnit),
    needsCurrentBg: !Number.isFinite(currentBgMmol),
    mealBolusUnits: NaN,
    correctionUnits: NaN,
    totalUnits: NaN,
    totalClampedToZero: false,
  };
  if (r.needsCarbRatio || r.needsBreadUnits || r.needsIsf || r.needsCurrentBg) return r;
  const mealBolus = breadUnits * carbRatioInsulinPerBreadUnit;
  if (!Number.isFinite(mealBolus)) {
    r.needsBreadUnits = true;
    return r;
  }
  r.mealBolusUnits = roundHalfUp(mealBolus);
  const target = Number.isFinite(targetBgMmol) ? targetBgMmol : currentBgMmol;
  const correction = correctionDoseUnits(currentBgMmol, target, isfMmolPerUnit);
  r.correctionUnits = roundHalfUp(Number.isFinite(correction) ? correction : 0);
  let total = r.mealBolusUnits + r.correctionUnits;
  if (total < 0) {
    total = 0;
    r.totalClampedToZero = true;
  }
  r.totalUnits = roundHalfUp(total);
  r.computed = true;
  return r;
}
