/**
 * Minimal Nightscout REST v1 client for the browser.
 *
 * Auth: an access token (Nightscout "Subjects" token, e.g. "xdripweb-1a2b3c4d5e6f7a8b") passed as the
 * {@code token} query parameter — Nightscout's CORS headers do not allow the {@code api-secret}
 * header from other origins, and a token can be revoked without touching the master password.
 *
 * Every user talks only to THEIR OWN Nightscout: the URL and token live in this browser only.
 */
import type { BgPoint } from '../core/selection';
import type { Treatment } from '../core/treatment';
import { mgdlToMmol } from '../core/units';
import { isRequestDoc, parseRequest, requestDoc, type PendingRequest, type SiteRequest } from './requests';

export interface Connection {
  /** e.g. https://example.nightscout.host (no trailing slash, no /api). */
  baseUrl: string;
  token: string;
}

export class NsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NsError';
  }
}

export interface Reading extends BgPoint {
  mgdl: number;
  direction: string | null;
}

/** A Nightscout treatment document (only the fields this app reads or writes). */
interface NsTreatment {
  _id?: string;
  uuid?: string;
  created_at?: string;
  timestamp?: number | string;
  mills?: number;
  eventType?: string;
  enteredBy?: string;
  carbs?: number | null;
  insulin?: number | null;
  insulinInjections?: string;
  notes?: string | null;
  /** Finger-stick ("BG Check"): value, its units and glucoseType "Finger". */
  glucose?: number | string | null;
  glucoseType?: string;
  units?: string;
}

/** A finger-stick (glucometer) reading. */
export interface MeterReading {
  timestamp: number;
  mmol: number;
  /** Nightscout documents holding it ("BG Check" treatments, "mbg" entries) — to delete it everywhere. */
  nsTreatmentIds?: string[];
  nsEntryIds?: string[];
}

interface NsEntry {
  _id?: string;
  date?: number;
  mills?: number;
  sgv?: number;
  direction?: string;
  type?: string;
}

export const WEB_ENTERED_BY = 'xDrip-web';

export function normaliseBaseUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, '').replace(/\/api(\/v\d)?$/i, '');
  return s;
}

function url(c: Connection, path: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${c.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  if (c.token) u.searchParams.set('token', c.token);
  return u.toString();
}

async function request<T>(c: Connection, path: string, init: RequestInit & { params?: Record<string, string | number> } = {}): Promise<T> {
  const { params, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url(c, path, params), { cache: 'no-store', ...rest });
  } catch {
    throw new NsError('Нет связи с Nightscout', 0);
  }
  if (res.status === 401 || res.status === 403) throw new NsError('Ключ доступа не подходит', res.status);
  if (!res.ok) throw new NsError(`Nightscout ответил ошибкой ${res.status}`, res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function treatmentTime(t: NsTreatment): number {
  if (typeof t.mills === 'number' && t.mills > 0) return t.mills;
  if (typeof t.timestamp === 'number' && t.timestamp > 0) return t.timestamp;
  if (typeof t.timestamp === 'string') {
    const v = Date.parse(t.timestamp);
    if (Number.isFinite(v)) return v;
  }
  return t.created_at ? Date.parse(t.created_at) : NaN;
}

/** mmol/L of a finger-stick treatment ("BG Check" / glucoseType Finger), or null. */
export function fingerBgOf(t: NsTreatment): number | null {
  if (t.glucoseType !== 'Finger' && t.eventType !== 'BG Check') return null;
  const v = typeof t.glucose === 'string' ? Number(t.glucose.replace(',', '.')) : t.glucose;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const units = (t.units ?? '').toLowerCase();
  const mmol = units.startsWith('mmol') ? v : units.startsWith('mg') ? mgdlToMmol(v) : v < 35 ? v : mgdlToMmol(v);
  return mmol > 0.5 && mmol < 40 ? mmol : null;
}

/** Joins finger-sticks from both places Nightscout keeps them, dropping the copy of the same reading. */
export function mergeMeter(a: readonly MeterReading[], b: readonly MeterReading[]): MeterReading[] {
  const out: MeterReading[] = [];
  for (const m of [...a, ...b].sort((x, y) => x.timestamp - y.timestamp)) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.timestamp - m.timestamp) <= 90_000 && Math.abs(prev.mmol - m.mmol) < 0.15) {
      // the same reading: remember where else it lives, so deleting it removes every copy
      out[out.length - 1] = {
        ...prev,
        nsTreatmentIds: [...(prev.nsTreatmentIds ?? []), ...(m.nsTreatmentIds ?? [])],
        nsEntryIds: [...(prev.nsEntryIds ?? []), ...(m.nsEntryIds ?? [])],
      };
      continue;
    }
    out.push(m);
  }
  return out;
}

export function toTreatment(t: NsTreatment): Treatment | null {
  const ts = treatmentTime(t);
  if (!Number.isFinite(ts)) return null;
  const carbs = typeof t.carbs === 'number' && Number.isFinite(t.carbs) ? t.carbs : 0;
  const insulin = typeof t.insulin === 'number' && Number.isFinite(t.insulin) ? t.insulin : 0;
  return {
    id: t.uuid || t._id || `${ts}`,
    timestamp: ts,
    carbs,
    insulin,
    insulinJSON: t.insulinInjections ?? null,
    notes: t.notes ?? null,
    eventType: t.eventType ?? null,
    enteredBy: t.enteredBy ?? null,
    nsId: t._id ?? null,
    uuid: t.uuid ?? null,
  };
}

/** Nightscout _id of a loaded treatment, so it can be updated or deleted. */
const nsIds = new Map<string, string>();
export const nsIdOf = (t: Treatment): string | undefined => nsIds.get(t.id);

export const ns = {
  /** Server status — also proves the URL is a Nightscout. */
  async status(c: Connection): Promise<{ name?: string; version?: string; settings?: { units?: string } }> {
    return request(c, '/api/v1/status.json');
  },

  /** Checks the token can write treatments (Nightscout reports the caller's permissions). */
  async verify(c: Connection): Promise<{ canRead: boolean; canWrite: boolean }> {
    try {
      const v = await request<{ message?: { canRead?: boolean; canWrite?: boolean } }>(c, '/api/v1/verifyauth');
      return { canRead: v?.message?.canRead !== false, canWrite: !!v?.message?.canWrite };
    } catch (e) {
      if (e instanceof NsError && e.status === 401) return { canRead: false, canWrite: false };
      throw e;
    }
  },

  async readings(c: Connection, from: number, to: number = Date.now() + 60_000): Promise<Reading[]> {
    const rows = await request<NsEntry[]>(c, '/api/v1/entries/sgv.json', {
      params: { 'find[date][$gte]': from, 'find[date][$lte]': to, count: 20000 },
    });
    const out: Reading[] = [];
    for (const r of rows ?? []) {
      const ts = r.mills ?? r.date;
      if (typeof ts !== 'number' || typeof r.sgv !== 'number' || r.sgv <= 0 || r.sgv >= 1000) continue;
      out.push({ timestamp: ts, mgdl: r.sgv, mmol: mgdlToMmol(r.sgv), direction: r.direction ?? null });
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
  },

  /** Food / insulin / note entries, the finger-sticks that came as "BG Check" treatments, and the site's requests still waiting for the master. */
  async treatments(
    c: Connection,
    from: number,
    to: number = Date.now() + 24 * 3_600_000,
  ): Promise<{ entries: Treatment[]; checks: MeterReading[]; requests: PendingRequest[] }> {
    const rows = await request<NsTreatment[]>(c, '/api/v1/treatments.json', {
      params: {
        'find[created_at][$gte]': new Date(from).toISOString(),
        'find[created_at][$lte]': new Date(to).toISOString(),
        count: 5000,
      },
    });
    const out: Treatment[] = [];
    const checks: MeterReading[] = [];
    const requests: PendingRequest[] = [];
    for (const r of rows ?? []) {
      const doc = r as unknown as Record<string, unknown>;
      if (isRequestDoc(doc)) {
        const p = parseRequest(doc);
        if (p) requests.push(p);
        continue;
      }
      const t = toTreatment(r);
      if (!t) continue;
      const bg = fingerBgOf(r);
      if (bg !== null) checks.push({ timestamp: t.timestamp, mmol: bg, nsTreatmentIds: r._id ? [r._id] : [] });
      // a pure finger-stick is not a food / insulin / note entry
      if (bg !== null && t.carbs <= 0 && t.insulin <= 0 && !t.notes) continue;
      if (r._id) nsIds.set(t.id, r._id);
      out.push(t);
    }
    return { entries: out.sort((a, b) => a.timestamp - b.timestamp), checks, requests };
  },

  /** Finger-sticks the master uploaded (xDrip sends them as "mbg" entries). */
  async meterEntries(c: Connection, from: number, to: number = Date.now() + 60_000): Promise<MeterReading[]> {
    const rows = await request<Array<{ _id?: string; date?: number; mbg?: number }>>(c, '/api/v1/entries/mbg.json', {
      params: { 'find[date][$gte]': from, 'find[date][$lte]': to, count: 2000 },
    });
    const out: MeterReading[] = [];
    for (const r of rows ?? []) {
      if (typeof r.date !== 'number' || typeof r.mbg !== 'number' || r.mbg <= 0 || r.mbg >= 1000) continue;
      out.push({ timestamp: r.date, mmol: mgdlToMmol(r.mbg), nsEntryIds: r._id ? [r._id] : [] });
    }
    return out;
  },

  /** Asks the master to change or delete an existing entry (see ns/requests.ts). */
  async sendRequest(c: Connection, r: SiteRequest): Promise<void> {
    await request(c, '/api/v1/treatments.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([requestDoc(r, Date.now())]),
    });
  },

  /** Adds a food / insulin / note entry. The master picks it up from Nightscout and syncs it on. */
  async addTreatment(c: Connection, e: { timestamp: number; carbs: number; insulin: number; notes: string; bgMmol?: number }): Promise<void> {
    const docs: NsTreatment[] = [];
    const base = (): NsTreatment => ({
      enteredBy: WEB_ENTERED_BY,
      created_at: new Date(e.timestamp).toISOString(),
      timestamp: e.timestamp,
      uuid: crypto.randomUUID(),
    });
    if (e.carbs > 0 || e.insulin > 0 || e.notes.trim()) {
      const doc: NsTreatment = { ...base(), eventType: '<none>', insulinInjections: '[]' };
      if (e.carbs > 0) doc.carbs = e.carbs;
      if (e.insulin > 0) doc.insulin = e.insulin;
      if (e.notes.trim()) doc.notes = e.notes.trim();
      docs.push(doc);
    }
    // a finger-stick is its own record, as when typed on the phone; the master takes "Finger" BG Checks
    if (e.bgMmol && e.bgMmol > 0) {
      docs.push({ ...base(), eventType: 'BG Check', glucose: Math.round(e.bgMmol * 10) / 10, glucoseType: 'Finger', units: 'mmol' });
    }
    if (docs.length === 0) return;
    await request(c, '/api/v1/treatments.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(docs),
    });
  },
};
