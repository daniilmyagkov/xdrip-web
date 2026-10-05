/**
 * Which entries are meals, доедания / подколки, or "not food" — port of
 * CarbRatioDataCollector.resolveRoles / Attachments / defaultForNewEntry / recentMeals.
 *
 * Rules for one entry, in order:
 *  1. "not a meal" marker            → ignored by the УК;
 *  2. "separate meal" marker         → its own meal;
 *  3. "attach" marker                → доедание / подколка;
 *  4. lone carbs OR lone insulin inside a preceding meal's отработка window → доедание / подколка;
 *  5. lone carbs outside every window (hypo carbs, tablets at night)        → not a meal;
 *  6. otherwise (carbs+insulin, or lone insulin outside any window)         → its own meal.
 * A meal with carbs opens (or restarts) a window; attached and not-a-meal entries never do.
 */
import { classify, type MealHours, type MealType } from './classifier';
import { isAttachedToPreviousMeal, isForcedSeparate, isNotMeal, parseIsf, type Role } from './notes';
import { bolusUnitsOf, byTimestampAsc, type Treatment } from './treatment';
import { DAY_MS } from './units';

export const ROLE_NONE = 0;
export const ROLE_MEAL = 1;
export const ROLE_ATTACHED = 2;
export const ROLE_NOT_MEAL = 3;
export type RoleCode = typeof ROLE_NONE | typeof ROLE_MEAL | typeof ROLE_ATTACHED | typeof ROLE_NOT_MEAL;

export function resolveRoles(
  timestamps: readonly number[],
  carbs: readonly number[],
  bolus: readonly number[],
  forcedAttach: readonly boolean[],
  forcedSeparate: readonly boolean[],
  forcedNotMeal: readonly boolean[],
  workoutMs: number,
): RoleCode[] {
  const n = timestamps.length;
  const out: RoleCode[] = new Array<RoleCode>(n).fill(ROLE_NONE);
  let anchorWindowEnd = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const hasCarbs = (carbs[i] ?? 0) > 0;
    const hasBolus = (bolus[i] ?? 0) > 0;
    if (!hasCarbs && !hasBolus) continue;
    const lone = hasCarbs !== hasBolus;
    const ts = timestamps[i] ?? 0;
    let role: RoleCode;
    if (forcedNotMeal[i]) role = ROLE_NOT_MEAL;
    else if (forcedSeparate[i]) role = ROLE_MEAL;
    else if (forcedAttach[i]) role = ROLE_ATTACHED;
    else if (lone && ts <= anchorWindowEnd) role = ROLE_ATTACHED;
    else if (hasCarbs && !hasBolus) role = ROLE_NOT_MEAL;
    else role = ROLE_MEAL;
    out[i] = role;
    if (role === ROLE_MEAL && hasCarbs) anchorWindowEnd = ts + workoutMs;
  }
  return out;
}

/** Legacy view used by the Android tests: true where the entry is a доедание / подколка. */
export function resolveAttachedFlags(
  timestamps: readonly number[],
  carbs: readonly number[],
  bolus: readonly number[],
  forcedAttach: readonly boolean[],
  forcedSeparate: readonly boolean[],
  workoutMs: number,
): boolean[] {
  return resolveRoles(timestamps, carbs, bolus, forcedAttach, forcedSeparate, new Array<boolean>(timestamps.length).fill(false), workoutMs).map(
    (r) => r === ROLE_ATTACHED,
  );
}

/** Roles of a whole (any-order) list of entries, keyed by entry id. */
export class Attachments {
  private readonly roles = new Map<string, RoleCode>();

  static resolve(entries: readonly Treatment[], workoutMs: number): Attachments {
    const a = new Attachments();
    const sorted = [...entries].sort(byTimestampAsc);
    const roles = resolveRoles(
      sorted.map((t) => t.timestamp),
      sorted.map((t) => t.carbs),
      sorted.map((t) => bolusUnitsOf(t)),
      sorted.map((t) => isAttachedToPreviousMeal(t.notes)),
      sorted.map((t) => isForcedSeparate(t.notes)),
      sorted.map((t) => isNotMeal(t.notes)),
      workoutMs,
    );
    sorted.forEach((t, i) => a.roles.set(t.id, roles[i] ?? ROLE_NONE));
    return a;
  }

  roleCode(t: Treatment): RoleCode {
    return this.roles.get(t.id) ?? ROLE_NONE;
  }

  isAttached(t: Treatment): boolean {
    return this.roleCode(t) === ROLE_ATTACHED;
  }

  isNotMeal(t: Treatment): boolean {
    return this.roleCode(t) === ROLE_NOT_MEAL;
  }

  role(t: Treatment): Role {
    const r = this.roleCode(t);
    return r === ROLE_ATTACHED ? 'ATTACHED' : r === ROLE_NOT_MEAL ? 'NOT_MEAL' : 'SEPARATE';
  }
}

export interface EntryDefault {
  role: Role;
  /** Timestamp of the meal a доедание / подколка would attach to, or 0. */
  anchorMealTime: number;
  anchorMealType: MealType | null;
}

/** What the automatic rule would make of a NEW entry at {@code timestamp} (existing entries untouched). */
export function defaultForNewEntry(
  existing: readonly Treatment[],
  timestamp: number,
  carbs: number,
  bolus: number,
  workoutMs: number,
  mealHours?: MealHours,
): EntryDefault {
  const from = timestamp - Math.max(workoutMs, DAY_MS);
  const before = existing.filter((t) => t.timestamp >= from && t.timestamp <= timestamp).sort(byTimestampAsc);
  const ts = [...before.map((t) => t.timestamp), timestamp];
  const c = [...before.map((t) => t.carbs), carbs];
  const b = [...before.map((t) => bolusUnitsOf(t)), bolus];
  const fa = [...before.map((t) => isAttachedToPreviousMeal(t.notes)), false];
  const fs = [...before.map((t) => isForcedSeparate(t.notes)), false];
  const fn = [...before.map((t) => isNotMeal(t.notes)), false];
  const roles = resolveRoles(ts, c, b, fa, fs, fn, workoutMs);
  let anchor = 0;
  let anchorType: MealType | null = null;
  for (let i = before.length - 1; i >= 0; i--) {
    if (roles[i] === ROLE_MEAL && (c[i] ?? 0) > 0) {
      const t = before[i] as Treatment;
      anchor = t.timestamp;
      anchorType = classify(t.timestamp, t.notes, mealHours);
      break;
    }
  }
  const r = roles[roles.length - 1];
  const role: Role = r === ROLE_ATTACHED ? 'ATTACHED' : r === ROLE_NOT_MEAL ? 'NOT_MEAL' : 'SEPARATE';
  return { role, anchorMealTime: anchor, anchorMealType: anchorType };
}

export interface Meal {
  timestamp: number;
  carbGrams: number;
  treatment: Treatment;
}

/** Carb entries in [now - windowMs, now] that are meals in their own right, newest first. */
export function recentMeals(entries: readonly Treatment[], now: number, windowMs: number, workoutMs: number): Meal[] {
  const attachments = Attachments.resolve(entries, workoutMs);
  return entries
    .filter((t) => t.carbs > 0 && t.timestamp >= now - windowMs && t.timestamp <= now)
    .filter((t) => !attachments.isAttached(t) && !attachments.isNotMeal(t))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((t) => ({ timestamp: t.timestamp, carbGrams: t.carbs, treatment: t }));
}

/** ФЧИ written in the newest earlier note (within 30 days) — used when the rule of 100 lacks history. */
export function previousMealIsf(entries: readonly Treatment[], mealTime: number): number {
  let best = NaN;
  let bestTs = Number.NEGATIVE_INFINITY;
  for (const t of entries) {
    if (!t.notes || t.timestamp >= mealTime || t.timestamp < mealTime - 30 * DAY_MS) continue;
    const isf = parseIsf(t.notes);
    if (Number.isFinite(isf) && t.timestamp > bestTs) {
      best = isf;
      bestTs = t.timestamp;
    }
  }
  return best;
}
