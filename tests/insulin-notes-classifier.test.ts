// Ports of InsulinActivityCurveTest, UkMealClassifierTest, UkNotesTest, ForwardDoseTest and
// CarbRatioDataCollectorTest (bolusUnits + auto-attach) — plus the "not a meal" rule.
import { describe, expect, it } from 'vitest';
import { forwardDose } from '../src/core/calculator';
import { classifyHour } from '../src/core/classifier';
import { actedFraction, remainingFraction } from '../src/core/insulin';
import * as N from '../src/core/notes';
import { resolveAttachedFlags, resolveRoles, ROLE_ATTACHED, ROLE_MEAL, ROLE_NOT_MEAL } from '../src/core/roles';
import { collectSupplements } from '../src/core/selection';
import { bolusUnitsOf } from '../src/core/treatment';

const D9 = 9;

describe('insulin activity curve', () => {
  it('canonical shape over a 5 h window', () => {
    expect(actedFraction(0, 5)).toBeCloseTo(0, D9);
    expect(actedFraction(1, 5)).toBeCloseTo(0.25, D9);
    expect(actedFraction(2, 5)).toBeCloseTo(0.6, D9);
    expect(actedFraction(3, 5)).toBeCloseTo(0.85, D9);
    expect(actedFraction(4, 5)).toBeCloseTo(0.92, D9);
    expect(actedFraction(5, 5)).toBeCloseTo(1, D9);
  });

  it('same shape compressed into a 4 h window', () => {
    expect(actedFraction(0.8, 4)).toBeCloseTo(0.25, D9);
    expect(actedFraction(1.6, 4)).toBeCloseTo(0.6, D9);
    expect(actedFraction(2.4, 4)).toBeCloseTo(0.85, D9);
    expect(actedFraction(3.2, 4)).toBeCloseTo(0.92, D9);
    expect(actedFraction(4.0, 4)).toBeCloseTo(1, D9);
    expect(actedFraction(1, 4)).toBeCloseTo(0.3375, D9);
    expect(actedFraction(2, 4)).toBeCloseTo(0.725, D9);
    expect(actedFraction(3, 4)).toBeCloseTo(0.9025, D9);
  });

  it('compression is pure rescaling', () => {
    for (let action = 2; action <= 8; action += 0.5) {
      for (let t = 0; t <= action; t += action / 20) {
        expect(actedFraction(t, action)).toBeCloseTo(actedFraction((t * 5) / action, 5), D9);
      }
    }
  });

  it('interpolates linearly inside a segment', () => {
    expect(actedFraction(0.5, 5)).toBeCloseTo(0.125, D9);
    expect(actedFraction(1.5, 5)).toBeCloseTo(0.425, D9);
  });

  it('never loses or invents insulin', () => {
    for (let action = 1; action <= 8; action += 0.5) {
      for (let h = -1; h <= action * 1.6; h += action / 30) {
        const acted = actedFraction(h, action);
        expect(acted).toBeGreaterThanOrEqual(0);
        expect(acted).toBeLessThanOrEqual(1);
        expect(acted + remainingFraction(h, action)).toBeCloseTo(1, D9);
      }
    }
  });

  it('rises monotonically and saturates at the window end', () => {
    let previous = -1;
    for (let h = 0; h <= 4; h += 0.02) {
      const acted = actedFraction(h, 3.5);
      expect(acted).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = acted;
    }
    expect(actedFraction(3.5, 3.5)).toBeCloseTo(1, D9);
    expect(actedFraction(99, 3.5)).toBeCloseTo(1, D9);
    expect(actedFraction(-5, 3.5)).toBeCloseTo(0, D9);
    expect(actedFraction(NaN, 3.5)).toBeCloseTo(0, D9);
  });

  it('non-positive action time gives zero', () => {
    expect(actedFraction(2, 0)).toBe(0);
    expect(actedFraction(2, -1)).toBe(0);
    expect(remainingFraction(2, 0)).toBe(1);
  });

  it("user's worked example: 2 U one hour after the meal, 4 h window → 1.805 U", () => {
    const meal = 1_700_000_000_000;
    const hour = 3_600_000;
    const s = collectSupplements([{ timestamp: meal + hour, bolusUnits: 2, attached: false }], meal, 30 * 60_000, meal + 4 * hour, null, 4);
    expect(s).toHaveLength(1);
    expect(s[0]?.effectiveUnits).toBeCloseTo(1.805, D9);
    expect(s[0]?.doseUnits).toBeCloseTo(2, D9);
  });
});

describe('meal classifier', () => {
  const at = (h: number) => classifyHour(h, 6, 12, 18);
  it('default boundaries', () => {
    for (const h of [6, 8.5, 11.99]) expect(at(h)).toBe('BREAKFAST');
    for (const h of [12, 15, 17.99]) expect(at(h)).toBe('LUNCH');
    for (const h of [18, 21, 23.5]) expect(at(h)).toBe('DINNER');
  });
  it('before breakfast wraps to dinner', () => {
    for (const h of [0, 3, 5.99]) expect(at(h)).toBe('DINNER');
  });
  it('custom boundaries', () => {
    expect(classifyHour(8, 9, 14, 20)).toBe('DINNER');
    expect(classifyHour(9, 9, 14, 20)).toBe('BREAKFAST');
    expect(classifyHour(13.5, 9, 14, 20)).toBe('BREAKFAST');
    expect(classifyHour(14, 9, 14, 20)).toBe('LUNCH');
    expect(classifyHour(19.9, 9, 14, 20)).toBe('LUNCH');
    expect(classifyHour(20, 9, 14, 20)).toBe('DINNER');
    expect(classifyHour(2, 9, 14, 20)).toBe('DINNER');
  });
  it('out-of-order or equal boundaries never crash', () => {
    for (let b = 0; b < 24; b += 5)
      for (let l = 0; l < 24; l += 5)
        for (let d = 0; d < 24; d += 5)
          for (let hh = 0; hh < 24; hh += 3) expect(['BREAKFAST', 'LUNCH', 'DINNER']).toContain(classifyHour(hh, b, l, d));
  });
  it('invalid hours fall back to defaults', () => {
    expect(classifyHour(7, -1, 99, 40)).toBe('BREAKFAST');
    expect(classifyHour(13, -1, 99, 40)).toBe('LUNCH');
    expect(classifyHour(19, -1, 99, 40)).toBe('DINNER');
  });
});

describe('notes', () => {
  it('withUpdatedUk replaces the fragment and keeps СКстарт and the human text', () => {
    const note = `обед  ${N.formatUk(1.2, 3.0, true)}  СКстарт 6.2`;
    const updated = N.withUpdatedUk(note, N.formatUk(1.35, 2.7, false));
    expect(N.parseUk(updated)).toBeCloseTo(1.35, D9);
    expect(N.parseIsf(updated)).toBeCloseTo(2.7, D9);
    expect(N.parseBgStart(updated)).toBeCloseTo(6.2, D9);
    expect(N.humanPart(updated)).toBe('обед');
    expect(updated.split('УК ').length - 1).toBe(1);
  });
  it('withUpdatedUk keeps a standalone ФЧИ pin', () => {
    const updated = N.withUpdatedUk('перекус ФЧИ 4', N.formatUk(0.9, 4.0, true));
    expect(N.pinnedIsf(updated)).toBeCloseTo(4, D9);
    expect(N.humanPart(updated)).toBe('перекус');
  });
  it('pinnedIsf: NaN for auto only, value for hand-set', () => {
    expect(N.pinnedIsf(`обед ${N.formatUk(1.1, 5.0, true)}`)).toBeNaN();
    expect(N.pinnedIsf(`обед ${N.formatUk(1.1, 5.0, false)}`)).toBeCloseTo(5, D9);
    expect(N.pinnedIsf('обед ФЧИ 3.5')).toBeCloseTo(3.5, D9);
    expect(N.pinnedIsf(`обед ФЧИ 3.5  ${N.formatUk(1.1, 3.5, true)}`)).toBeCloseTo(3.5, D9);
  });
  it('setPinnedIsf adds the pin and keeps the УК fragment', () => {
    const out = N.setPinnedIsf(`ужин ${N.formatUk(1.0, 5.0, true)} СКстарт 7`, 3.3);
    expect(N.pinnedIsf(out)).toBeCloseTo(3.3, D9);
    expect(N.parseUk(out)).toBeCloseTo(1.0, D9);
    expect(N.parseBgStart(out)).toBeCloseTo(7, D9);
    expect(N.humanPart(out)).toBe('ужин');
  });
  it('setPinnedIsf with blank removes the pin', () => {
    const out = N.setPinnedIsf('завтрак ФЧИ 2.8', NaN);
    expect(N.pinnedIsf(out)).toBeNaN();
    expect(out).toBe('завтрак');
  });
  it('setPinnedIsf replaces an existing pin', () => {
    const out = N.setPinnedIsf('обед ФЧИ 2.8 СКстарт 6', 4.1);
    expect(N.pinnedIsf(out)).toBeCloseTo(4.1, D9);
    expect(out.split('ФЧИ').length - 1).toBe(1);
  });
  it('parseIsf reads a comma decimal', () => expect(N.parseIsf('что-то ФЧИ 2,75')).toBeCloseTo(2.75, D9));
  it('humanPart strips a standalone ФЧИ marker', () => expect(N.humanPart('салат ФЧИ 3 СКстарт 5')).toBe('салат'));
  it('formatUk matches the Android text exactly', () => {
    expect(N.formatUk(1.16, 4.761904761904762, true)).toBe('УК 1.16 ед/ХЕ (ФЧИ 4.7619) авто');
    expect(N.formatUk(0.9, 4, false)).toBe('УК 0.90 ед/ХЕ (ФЧИ 4)');
  });
  it('role and meal-type markers round-trip and stay byte-compatible', () => {
    expect(N.setRole('салат', 'NOT_MEAL')).toBe('салат ⊘не еда');
    expect(N.setRole('салат ⊘не еда', 'ATTACHED')).toBe('салат ↑к приёму');
    expect(N.setRole('↷отдельно', null)).toBe('');
    expect(N.isNotMeal('⊘не еда')).toBe(true);
    expect(N.setMealType('', 'LUNCH')).toBe('#обед');
    expect(N.parseMealType('x #Ужин')).toBe('DINNER');
    expect(N.humanPart('паста #обед ↷отдельно')).toBe('паста');
  });
});

describe('forward dose', () => {
  it('meal bolus plus correction', () => {
    const r = forwardDose(10, 6, 2, 5, 0.9);
    expect(r.computed).toBe(true);
    expect(r.mealBolusUnits).toBeCloseTo(4.5, D9);
    expect(r.correctionUnits).toBeCloseTo(2, D9);
    expect(r.totalUnits).toBeCloseTo(6.5, D9);
  });
  it('correction is negative when below target', () => {
    const r = forwardDose(4, 6, 2, 3, 1);
    expect(r.correctionUnits).toBeCloseTo(-1, D9);
    expect(r.totalUnits).toBeCloseTo(2, D9);
    expect(r.totalClampedToZero).toBe(false);
  });
  it('total never goes below zero', () => {
    const r = forwardDose(3, 9, 2, 0.5, 1);
    expect(r.correctionUnits).toBeLessThan(0);
    expect(r.totalUnits).toBeCloseTo(0, D9);
    expect(r.totalClampedToZero).toBe(true);
  });
  it('reports missing inputs', () => {
    const r = forwardDose(NaN, 6, 0, 0, 0);
    expect(r.computed).toBe(false);
    expect(r.needsCurrentBg && r.needsIsf && r.needsBreadUnits && r.needsCarbRatio).toBe(true);
  });
  it('missing target falls back to no correction', () => {
    const r = forwardDose(8, NaN, 2, 4, 1);
    expect(r.correctionUnits).toBeCloseTo(0, D9);
    expect(r.totalUnits).toBeCloseTo(4, D9);
  });
});

describe('bolus units of an entry', () => {
  it('"[]" falls back to the flat field', () => expect(bolusUnitsOf({ insulinJSON: '[]', insulin: 2 })).toBeCloseTo(2, D9));
  it('null / blank JSON falls back', () => {
    expect(bolusUnitsOf({ insulinJSON: null, insulin: 3.5 })).toBeCloseTo(3.5, D9);
    expect(bolusUnitsOf({ insulinJSON: '   ', insulin: 3.5 })).toBeCloseTo(3.5, D9);
  });
  it('sums injections from JSON', () =>
    expect(bolusUnitsOf({ insulinJSON: '[{"units":3.0,"insulin":"Fiasp"},{"units":1.5,"insulin":"NovoRapid"}]', insulin: 0 })).toBeCloseTo(4.5, D9));
  it('malformed JSON falls back', () => expect(bolusUnitsOf({ insulinJSON: 'not json', insulin: 2 })).toBeCloseTo(2, D9));
});

describe('auto-attach (resolveAttachedFlags / resolveRoles)', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const WORKOUT = 3 * HOUR + 30 * MIN;
  const T0 = 1_700_000_000_000;
  const no = (n: number) => new Array<boolean>(n).fill(false);
  const flags = (ts: number[], c: number[], b: number[], fa: boolean[], fs: boolean[]) => resolveAttachedFlags(ts, c, b, fa, fs, WORKOUT);

  it('lone carb or insulin inside the window attaches, a full meal does not', () => {
    expect(flags([T0, T0 + HOUR, T0 + 2 * HOUR], [60, 20, 0], [6, 0, 2], no(3), no(3))).toEqual([false, true, true]);
  });
  it('lone carb outside the window is not attached', () => {
    expect(flags([T0, T0 + WORKOUT + 10 * MIN], [60, 30], [6, 0], no(2), no(2))).toEqual([false, false]);
  });
  it('separate marker overrides and opens its own window', () => {
    const r = flags([T0, T0 + HOUR, T0 + 90 * MIN], [60, 25, 15], [6, 0, 0], no(3), [false, true, false]);
    expect(r[1]).toBe(false);
    expect(r[2]).toBe(true);
  });
  it('attach marker overrides out of the window', () => {
    expect(flags([T0, T0 + WORKOUT + HOUR], [60, 30], [6, 0], [false, true], no(2))[1]).toBe(true);
  });
  it('a second full meal takes over as the anchor', () => {
    expect(flags([T0, T0 + 2 * HOUR, T0 + 3 * HOUR], [50, 70, 20], [5, 7, 0], no(3), no(3))).toEqual([false, false, true]);
  });
  it('lone carbs outside every window are NOT a meal (sugar tablets at night)', () => {
    const r = resolveRoles([T0, T0 + WORKOUT + HOUR], [60, 15], [6, 0], no(2), no(2), no(2), WORKOUT);
    expect(r).toEqual([ROLE_MEAL, ROLE_NOT_MEAL]);
  });
  it('a not-a-meal entry never opens a window', () => {
    const r = resolveRoles([T0, T0 + 30 * MIN], [15, 10], [0, 0], no(2), no(2), no(2), WORKOUT);
    expect(r).toEqual([ROLE_NOT_MEAL, ROLE_NOT_MEAL]);
  });
  it('the forced not-a-meal marker wins over everything', () => {
    const r = resolveRoles([T0, T0 + HOUR], [60, 40], [6, 4], no(2), no(2), [false, true], WORKOUT);
    expect(r).toEqual([ROLE_MEAL, ROLE_NOT_MEAL]);
    expect(resolveRoles([T0, T0 + HOUR], [60, 20], [6, 0], no(2), no(2), no(2), WORKOUT)[1]).toBe(ROLE_ATTACHED);
  });
});
