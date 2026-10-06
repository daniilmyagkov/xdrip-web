import { describe, expect, it } from 'vitest';
import { fingerBgOf, mergeMeter } from '../src/ns/client';

describe('finger-stick readings', () => {
  it('reads a BG Check in mmol and in mg/dL', () => {
    expect(fingerBgOf({ eventType: 'BG Check', glucose: 5.6, glucoseType: 'Finger', units: 'mmol' })).toBeCloseTo(5.6, 6);
    expect(fingerBgOf({ eventType: 'BG Check', glucose: 101, glucoseType: 'Finger', units: 'mg/dl' })).toBeCloseTo(101 / 18.0182, 4);
    expect(fingerBgOf({ glucose: '6,2', glucoseType: 'Finger' })).toBeCloseTo(6.2, 6);
  });
  it('ignores other treatments and nonsense', () => {
    expect(fingerBgOf({ eventType: '<none>', carbs: 20 })).toBeNull();
    expect(fingerBgOf({ eventType: 'BG Check', glucose: 0 })).toBeNull();
    expect(fingerBgOf({ eventType: 'BG Check', glucose: 'abc' })).toBeNull();
  });
  it('drops the copy the master uploads back', () => {
    const t = 1_791_270_000_000;
    const merged = mergeMeter([{ timestamp: t, mmol: 5.6 }], [{ timestamp: t + 30_000, mmol: 5.6 }, { timestamp: t + 3_600_000, mmol: 7.1 }]);
    expect(merged.map((m) => m.mmol)).toEqual([5.6, 7.1]);
  });
});
