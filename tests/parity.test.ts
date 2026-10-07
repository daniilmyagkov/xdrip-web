// End-to-end parity with the Android app. Rebuilds EXACTLY the data the Android emulator was seeded
// with on 2026-10-03 (same glucose curve, same three days of meals, the 10:05 breakfast) and checks
// the web pipeline gives the numbers the Android meal card showed:
//   Glucose 6.3535 → 6.2496 mmol/L, ISF 4.7619, Bolus 7 U, 6 BU, carb ratio 1.16 U/BU.
import { describe, expect, it } from 'vitest';
import { estimateMeal } from '../src/core/pull';
import { recentMeals } from '../src/core/roles';
import { effective } from '../src/core/settings';
import type { Treatment } from '../src/core/treatment';
import { mgdlToMmol } from '../src/core/units';

// Runs in Europe/Moscow (set by the npm test script) — the emulator's time zone; local midnight
// decides which days feed the ФЧИ.

const H = 3_600_000;
const M = 60_000;
const NOW_SEED = 1791029977 * 1000; // emulator clock when the data was seeded (15:19:37 MSK)

function seed(): { readings: { timestamp: number; mmol: number }[]; entries: Treatment[]; breakfast: number } {
  const d = new Date(NOW_SEED);
  d.setHours(0, 0, 0, 0);
  const mid = d.getTime();
  const meals: Array<[number, number, number]> = [];
  for (const day of [3, 2, 1]) {
    for (const [h, carbs, ins] of [
      [8, 40, 6],
      [13, 60, 8],
      [19, 50, 7],
    ] as const) {
      meals.push([mid - day * 24 * H + h * H, carbs, ins]);
    }
  }
  const todayMeal = NOW_SEED - (5 * H + 15 * M);
  const bumps: Array<[number, number, number]> = [...meals, [todayMeal, 60, 7]];
  const bg = (t: number): number => {
    let v = 110 + 12 * Math.sin(t / (7 * H));
    for (const [mt, carbs, ins] of bumps) {
      const x = (t - mt) / H;
      if (x > 0 && x < 6) {
        v += carbs * 1.6 * (x / 1.1) * Math.exp(1 - x / 1.1);
        v -= ins * 9 * (1 - Math.exp(-x / 1.5)) * Math.max(0, 1 - x / 6) * 0.6;
      }
    }
    return Math.max(55, v);
  };
  const readings: { timestamp: number; mmol: number }[] = [];
  for (let t = NOW_SEED - 4 * 24 * H; t <= NOW_SEED - 60_000; t += 5 * M) readings.push({ timestamp: t, mmol: mgdlToMmol(bg(t)) });
  const entries: Treatment[] = meals.map(([ts, carbs, insulin], i) => ({ id: `m${i}`, timestamp: ts, carbs, insulin, notes: null }));
  // entered through the keypad, then moved to 10:05 in the edit dialog (seconds zeroed, ms kept)
  const b = new Date(NOW_SEED);
  b.setHours(10, 5, 0, 753);
  entries.push({ id: 'breakfast', timestamp: b.getTime(), carbs: 60, insulin: 7, notes: null });
  return { readings, entries, breakfast: b.getTime() };
}

describe('parity with the Android app (emulator data of 2026-10-03)', () => {
  it('reproduces the meal card: 6.3535 → 6.2496, ISF 4.7619, УК 1.16', () => {
    const data = seed();
    const viewedAt = NOW_SEED + 6 * M; // the card was opened at ~15:25
    const meal = data.entries.find((t) => t.id === 'breakfast') as Treatment;
    const { pulled, result, isfOrigin } = estimateMeal(data, meal, viewedAt, effective());
    expect(pulled.bgStartMmol).toBeCloseTo(6.3535, 4);
    expect(pulled.bgEndMmol).toBeCloseTo(6.2496, 4);
    expect(pulled.bolusUnits).toBeCloseTo(7, 9);
    expect(pulled.carbGrams).toBeCloseTo(60, 9);
    expect(pulled.isfMmolPerUnit).toBeCloseTo(4.7619, 4);
    expect(isfOrigin).toBe('RULE_OF_100');
    expect(pulled.windowComplete).toBe(true);
    expect(result.insulinPerBreadUnit).toBe(1.16);
  });

  it('a glucometer measurement within ±5 min of the meal is its starting sugar', () => {
    const data = seed();
    const viewedAt = NOW_SEED + 6 * M;
    const meal = data.entries.find((t) => t.id === 'breakfast') as Treatment;
    const withStick = (meter: { timestamp: number; mmol: number }[]) => estimateMeal({ ...data, meter }, meal, viewedAt, effective()).pulled;
    // 3 min before and 2 min after: the nearer one (after) wins
    const p = withStick([
      { timestamp: data.breakfast - 3 * M, mmol: 5.7 },
      { timestamp: data.breakfast + 2 * M, mmol: 6.9 },
    ]);
    expect(p.bgStartMmol).toBe(6.9);
    expect(p.bgStartFromMeter).toBe(true);
    // 6 min away: the sensor as before
    const far = withStick([{ timestamp: data.breakfast - 6 * M, mmol: 5.0 }]);
    expect(far.bgStartMmol).toBeCloseTo(6.3535, 4);
    expect(far.bgStartFromMeter).toBe(false);
    // a sugar typed into the meal («СК перед едой») still wins
    const pinnedMeal = { ...meal, notes: 'СКстарт 7.4' };
    const pinned = estimateMeal(
      { ...data, entries: data.entries.map((t) => (t.id === 'breakfast' ? pinnedMeal : t)), meter: [{ timestamp: data.breakfast, mmol: 5.7 }] },
      pinnedMeal,
      viewedAt,
      effective(),
    ).pulled;
    expect(pinned.bgStartMmol).toBe(7.4);
    expect(pinned.bgStartFromMeter).toBe(false);
  });

  it('the meals list has the same ten meals as the Android «Приёмы» screen', () => {
    const data = seed();
    const meals = recentMeals(data.entries, NOW_SEED + 6 * M, 30 * 24 * H, effective().workoutMs);
    expect(meals).toHaveLength(10);
    expect(meals[0]?.treatment.id).toBe('breakfast');
  });
});
