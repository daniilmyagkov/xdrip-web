/** Time and glucose-unit helpers shared by the whole core. Mirrors xDrip's Constants. */

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** xDrip: Constants.MMOLL_TO_MGDL. Nightscout stores glucose in mg/dL. */
export const MMOLL_TO_MGDL = 18.0182;

export function mgdlToMmol(mgdl: number): number {
  return mgdl / MMOLL_TO_MGDL;
}

export function mmolToMgdl(mmol: number): number {
  return mmol * MMOLL_TO_MGDL;
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Java's {@code BigDecimal.valueOf(v).setScale(scale, HALF_UP)}: rounds the SHORTEST decimal
 * representation of {@code v} (so 1.005 -> 1.01, unlike Math.round(1.005 * 100) / 100 = 1.00).
 * The Android app rounds the УК this way; the web app must show the same digits.
 */
export function roundHalfUp(value: number, scale = 2): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const abs = Math.abs(value);
  const text = abs.toString();
  if (/e/i.test(text)) {
    // exponent notation: tiny or huge magnitudes, where float rounding is exact enough
    const factor = 10 ** scale;
    const r = Math.round(abs * factor) / factor;
    return negative ? -r : r;
  }
  const [intPart = '0', fracPart = ''] = text.split('.');
  if (fracPart.length <= scale) return value;
  const keep = fracPart.slice(0, scale);
  const nextDigit = fracPart.charCodeAt(scale) - 48;
  let digits = intPart + keep; // integer string scaled by 10^scale
  if (nextDigit >= 5) digits = incrementDecimalString(digits);
  const scaled = digits.padStart(scale + 1, '0');
  const result = Number(`${scaled.slice(0, scaled.length - scale)}.${scaled.slice(scaled.length - scale)}`);
  return negative ? -result : result;
}

function incrementDecimalString(digits: string): string {
  const chars = digits.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === '9') {
      chars[i] = '0';
      i--;
    } else {
      chars[i] = String.fromCharCode((chars[i] ?? '0').charCodeAt(0) + 1);
      return chars.join('');
    }
  }
  return `1${chars.join('')}`;
}

/** Local midnight of the day containing {@code ts} (device time zone, like Calendar on Android). */
export function localMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
