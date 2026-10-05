/** Display helpers — Russian conventions, as in the Android app (decimal comma, 24 h clock). */
import type { MealType } from '../core/classifier';

export function num(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits).replace('.', ',');
}

/** Up to {@code max} decimals, trailing zeros dropped: 7 → "7", 1.5 → "1,5". */
export function trim(v: number, max = 2): string {
  if (!Number.isFinite(v)) return '—';
  return String(Number(v.toFixed(max))).replace('.', ',');
}

export const mmol = (v: number): string => num(v, 1);

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'сегодня';
  if (diffDays === -1) return 'вчера';
  return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function minutesAgo(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин назад`;
}

/** Nightscout direction → arrow. */
export function arrow(direction: string | null | undefined): string {
  switch (direction) {
    case 'DoubleUp':
      return '⇈';
    case 'SingleUp':
      return '↑';
    case 'FortyFiveUp':
      return '↗';
    case 'Flat':
      return '→';
    case 'FortyFiveDown':
      return '↘';
    case 'SingleDown':
      return '↓';
    case 'DoubleDown':
      return '⇊';
    default:
      return '';
  }
}

export const MEAL_LABEL: Record<MealType, string> = { BREAKFAST: 'Завтрак', LUNCH: 'Обед', DINNER: 'Ужин' };
export const mealLabelLower = (t: MealType): string => MEAL_LABEL[t].toLowerCase();
