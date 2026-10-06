/**
 * A food / insulin / note entry as the core sees it. Built from a Nightscout treatment document;
 * the same shape xDrip's Treatments table has (timestamp in ms, carbs g, insulin U, note text).
 */
export interface Treatment {
  /** xDrip's uuid when the entry came from xDrip, otherwise the Nightscout _id. */
  id: string;
  timestamp: number;
  carbs: number;
  insulin: number;
  /** xDrip's per-injection JSON ("[]" or e.g. [{"units":4,"insulin":"Fiasp"}]). */
  insulinJSON?: string | null;
  notes: string | null;
  eventType?: string | null;
  enteredBy?: string | null;
  /** Nightscout _id of its document (to change or delete it). */
  nsId?: string | null;
  /** The document's uuid field, when it has one. */
  uuid?: string | null;
}

/**
 * Insulin units of an entry: the sum of the per-injection JSON when it has entries, otherwise
 * the flat {@code insulin} field (port of CarbRatioDataCollector.bolusUnits).
 */
export function bolusUnitsOf(t: Pick<Treatment, 'insulinJSON' | 'insulin'>): number {
  const json = t.insulinJSON?.trim();
  if (json && json !== '[]') {
    try {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let sum = 0;
        for (const inj of parsed) {
          const u = (inj as { units?: unknown } | null)?.units;
          if (typeof u === 'number' && Number.isFinite(u)) sum += u;
        }
        if (Number.isFinite(sum)) return sum;
      }
    } catch {
      // malformed JSON — fall back to the flat total
    }
  }
  return Number.isFinite(t.insulin) ? t.insulin : 0;
}

export const byTimestampAsc = (a: { timestamp: number }, b: { timestamp: number }): number => a.timestamp - b.timestamp;
