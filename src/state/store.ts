/**
 * Data loading + periodic refresh. Glucose for the last 4 days (graph + the meals whose УК can
 * still be estimated live) and entries for the last 40 days (meals list, ФЧИ history, previous ФЧИ).
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Treatment } from '../core/treatment';
import { DAY_MS } from '../core/units';
import { ns, NsError, type Connection, type Reading } from '../ns/client';

export const READINGS_DAYS = 4;
export const ENTRIES_DAYS = 40;
const REFRESH_MS = 60_000;

export interface Snapshot {
  readings: Reading[];
  entries: Treatment[];
  loadedAt: number;
  thresholds: { low: number; high: number };
}

export interface StoreState {
  data: Snapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const MGDL = 18.0182;

export function useStore(c: Connection | null): StoreState {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!c || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const now = Date.now();
      const [readings, entries, status] = await Promise.all([
        ns.readings(c, now - READINGS_DAYS * DAY_MS),
        ns.treatments(c, now - ENTRIES_DAYS * DAY_MS),
        ns.status(c).catch(() => null),
      ]);
      const th = (status as { settings?: { thresholds?: { bgTargetBottom?: number; bgTargetTop?: number } } } | null)?.settings?.thresholds;
      setData({
        readings,
        entries,
        loadedAt: now,
        thresholds: {
          low: th?.bgTargetBottom ? th.bgTargetBottom / MGDL : 3.9,
          high: th?.bgTargetTop ? th.bgTargetTop / MGDL : 10,
        },
      });
      setError(null);
    } catch (e) {
      setError(e instanceof NsError ? e.message : 'Не удалось загрузить данные');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [c]);

  useEffect(() => {
    if (!c) return;
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [c, refresh]);

  return { data, loading, error, refresh };
}
