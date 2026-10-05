/**
 * Markers kept inside a treatment's note — port of UkNotes.java. The note is the only per-entry
 * field that travels between xDrip, Nightscout and this web app, so every meal decision (role,
 * meal type, saved УК / ФЧИ, pinned СК_старт) lives here as plain text. Keep byte-compatible with
 * the Android app: the same strings must be written and recognised on both sides.
 */
import type { MealType } from './classifier';

export const PREFIX = 'УК ';
export const ATTACH_MARKER = '↑к приёму';
export const SEPARATE_MARKER = '↷отдельно';
export const NOT_MEAL_MARKER = '⊘не еда';
export const BG_START_MARKER = 'СКстарт ';

export type Role = 'ATTACHED' | 'SEPARATE' | 'NOT_MEAL';

const ATTACH = /(↑|доед|подкол|докол|к приёму|к приему)/giu;
const SEPARATE = /(↷отдельно|отдельный приём|отдельный прием)/giu;
const NOT_MEAL = /(⊘\s*не еда|не еда)/giu;
const MEAL_TYPE = /#(завтрак|обед|ужин)/iu;
const MEAL_TYPE_ALL = /#(завтрак|обед|ужин)/giu;
const BG_START = /СКстарт\s*([0-9]+(?:[.,][0-9]+)?)/u;
const BG_START_ALL = /СКстарт\s*([0-9]+(?:[.,][0-9]+)?)/gu;
const UK_FRAGMENT = /УК [0-9][0-9.,]*\s*ед\/ХЕ\s*\([^)]*\)(?:\s*авто)?/gu;
const UK_FRAGMENT_ONE = /УК [0-9][0-9.,]*\s*ед\/ХЕ\s*\([^)]*\)(?:\s*авто)?/u;
const UK_FRAGMENT_AUTO = /УК [0-9][0-9.,]*\s*ед\/ХЕ\s*\([^)]*\)\s*авто/gu;
const ISF_ANY = /ФЧИ\s*[0-9]+(?:[.,][0-9]+)?/gu;
const ISF_VALUE = /ФЧИ\s*([0-9]+(?:[.,][0-9]+)?)/u;
const UK_VALUE = /УК ([0-9]+(?:[.,][0-9]+)?)/u;

const test = (re: RegExp, s: string): boolean => {
  re.lastIndex = 0;
  return re.test(s);
};

function tidy(s: string): string {
  return s.replace(/\s*→\s*/gu, ' ').replace(/\s{2,}/gu, ' ').trim();
}

function parseNumber(text: string | undefined): number {
  if (text === undefined) return NaN;
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

/** Java DecimalFormat("0.####", US): up to 4 decimals, no trailing zeros. */
export function trimFormat(v: number): string {
  return String(Number(v.toFixed(4)));
}

export function isAttachedToPreviousMeal(notes: string | null | undefined): boolean {
  return !!notes && test(ATTACH, notes);
}

export function isForcedSeparate(notes: string | null | undefined): boolean {
  return !!notes && test(SEPARATE, notes);
}

export function isNotMeal(notes: string | null | undefined): boolean {
  return !!notes && test(NOT_MEAL, notes);
}

/** Write the role marker, or with {@code null} remove every role marker (automatic rule decides). */
export function setRole(notes: string | null | undefined, role: Role | null): string {
  let base = (notes ?? '').replace(ATTACH, '');
  base = base.replace(SEPARATE, '');
  base = tidy(base.replace(NOT_MEAL, ''));
  if (role === null) return base;
  const marker = role === 'ATTACHED' ? ATTACH_MARKER : role === 'SEPARATE' ? SEPARATE_MARKER : NOT_MEAL_MARKER;
  return base === '' ? marker : `${base} ${marker}`;
}

export function setAttached(notes: string | null | undefined, attached: boolean): string {
  let base = (notes ?? '').replace(ATTACH, '');
  base = base.replace(SEPARATE, '').trim().replace(/\s{2,}/gu, ' ');
  const marker = attached ? ATTACH_MARKER : SEPARATE_MARKER;
  return base === '' ? marker : `${base} ${marker}`;
}

export function parseMealType(notes: string | null | undefined): MealType | null {
  if (!notes) return null;
  const m = MEAL_TYPE.exec(notes);
  if (!m || !m[1]) return null;
  const v = m[1].toLowerCase();
  return v === 'завтрак' ? 'BREAKFAST' : v === 'обед' ? 'LUNCH' : 'DINNER';
}

export function setMealType(notes: string | null | undefined, type: MealType | null): string {
  const base = tidy((notes ?? '').replace(MEAL_TYPE_ALL, ''));
  if (type === null) return base;
  const marker = type === 'BREAKFAST' ? '#завтрак' : type === 'LUNCH' ? '#обед' : '#ужин';
  return base === '' ? marker : `${base} ${marker}`;
}

export function parseBgStart(notes: string | null | undefined): number {
  if (!notes) return NaN;
  return parseNumber(BG_START.exec(notes)?.[1]);
}

export function setBgStart(notes: string | null | undefined, valueMmol: number): string {
  const base = (notes ?? '').replace(BG_START_ALL, '').trim();
  if (!Number.isFinite(valueMmol) || valueMmol <= 0) return base;
  const marker = BG_START_MARKER + trimFormat(valueMmol);
  return base === '' ? marker : `${base} ${marker}`;
}

/** The free-text part of a note with every УК marker stripped. */
export function humanPart(notes: string | null | undefined): string {
  if (!notes) return '';
  let s = notes.replace(UK_FRAGMENT, '');
  s = s.replace(ISF_ANY, '');
  s = s.replace(BG_START_ALL, '');
  s = s.replace(ATTACH, '');
  s = s.replace(SEPARATE, '');
  s = s.replace(NOT_MEAL, '');
  s = s.replace(MEAL_TYPE_ALL, '');
  return tidy(s);
}

export function parseIsf(notes: string | null | undefined): number {
  if (!notes) return NaN;
  return parseNumber(ISF_VALUE.exec(notes)?.[1]);
}

/** A ФЧИ fixed by hand for this meal (standalone pin or a non-«авто» УК fragment); NaN otherwise. */
export function pinnedIsf(notes: string | null | undefined): number {
  if (!notes) return NaN;
  return parseIsf(notes.replace(UK_FRAGMENT_AUTO, ''));
}

export function setPinnedIsf(notes: string | null | undefined, valueMmolPerUnit: number): string {
  const src = notes ?? '';
  const fragment = UK_FRAGMENT_ONE.exec(src)?.[0] ?? null;
  let rest = fragment !== null ? src.replace(fragment, '') : src;
  rest = tidy(rest.replace(ISF_ANY, ''));
  if (Number.isFinite(valueMmolPerUnit) && valueMmolPerUnit > 0) {
    const marker = `ФЧИ ${trimFormat(valueMmolPerUnit)}`;
    rest = rest === '' ? marker : `${rest} ${marker}`;
  }
  if (fragment === null) return rest;
  return rest === '' ? fragment : `${rest}  ${fragment}`;
}

export function withUpdatedUk(notes: string | null | undefined, newUkNote: string): string {
  if (!notes || notes.trim() === '') return newUkNote;
  const stripped = tidy(notes.replace(UK_FRAGMENT, ''));
  return stripped === '' ? newUkNote : `${stripped}  ${newUkNote}`;
}

export function formatUk(insulinPerBreadUnit: number, isfMmolPerUnit: number, auto: boolean): string {
  return `${PREFIX}${insulinPerBreadUnit.toFixed(2)} ед/ХЕ (ФЧИ ${trimFormat(isfMmolPerUnit)})${auto ? ' авто' : ''}`;
}

export function alreadyPresent(notes: string | null | undefined): boolean {
  return !!notes && notes.includes(PREFIX);
}

/** Saved УК (insulin per 1 ХЕ) from a note, or NaN. */
export function parseUk(notes: string | null | undefined): number {
  if (!notes) return NaN;
  return parseNumber(UK_VALUE.exec(notes)?.[1]);
}

/** True when the saved УК was written by the master's auto-compute worker («авто»). */
export function isAutoUk(notes: string | null | undefined): boolean {
  return !!notes && test(UK_FRAGMENT_AUTO, notes);
}
