/**
 * Changes to entries that already exist: "delete it", "change it to …". The site cannot reach the
 * phones, so it leaves a request in Nightscout. The master carries it out exactly like the same button
 * in the app — its followers get it through xDrip's sync — and removes the request (Android side:
 * webaccess/SiteRequests.java). Until then every browser applies the requests still waiting in
 * Nightscout to what it shows, so the change is visible everywhere at once.
 */
import { byTimestampAsc, type Treatment } from '../core/treatment';
import type { MeterReading } from './client';

export const REQUEST_EVENT = 'xDrip-web';
export const REQUEST_FIELD = 'xdripWeb';
const MGDL = 18.0182;

export interface ChangeSet {
  timestamp: number;
  carbs: number;
  insulin: number;
  notes: string;
}

export interface SiteRequest {
  op: 'update' | 'delete';
  kind: 'treatment' | 'bloodtest';
  /** Nightscout _id of the entry's document. */
  id?: string;
  uuid?: string | null;
  /** Where the entry was when asked (ms): the master checks it is still the same entry. */
  at: number;
  /** Finger-stick value (mg/dL), to find it on the phone. */
  mgdl?: number;
  set?: ChangeSet;
  /** Nightscout documents holding a finger-stick, removed with it. */
  ns?: { treatments?: string[]; entries?: string[] };
}

export interface PendingRequest extends SiteRequest {
  createdAt: number;
}

const isNsId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{24}$/i.test(s);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** True for a request document (never an entry of its own). */
export function isRequestDoc(doc: { eventType?: unknown } & Record<string, unknown>): boolean {
  return REQUEST_FIELD in doc || doc.eventType === REQUEST_EVENT;
}

/** The request a Nightscout document carries, or null when it is not a usable one (the master ignores those too). */
export function parseRequest(doc: Record<string, unknown>): PendingRequest | null {
  const w = doc[REQUEST_FIELD] as Partial<SiteRequest> | undefined;
  if (!w || typeof w !== 'object') return null;
  if (w.op !== 'update' && w.op !== 'delete') return null;
  const kind = w.kind ?? 'treatment';
  if (kind !== 'treatment' && kind !== 'bloodtest') return null;
  if (!finite(w.at) || w.at <= 0) return null;
  const id = isNsId(w.id) ? w.id : undefined;
  const uuid = typeof w.uuid === 'string' && w.uuid ? w.uuid : null;
  if (kind === 'treatment' && !id && !uuid) return null;
  if (kind === 'bloodtest' && (w.op !== 'delete' || !finite(w.mgdl) || w.mgdl <= 0)) return null;
  let set: ChangeSet | undefined;
  if (w.op === 'update') {
    const s = w.set;
    if (!s || !finite(s.timestamp) || !finite(s.carbs) || !finite(s.insulin) || s.carbs < 0 || s.insulin < 0) return null;
    set = { timestamp: s.timestamp, carbs: s.carbs, insulin: s.insulin, notes: typeof s.notes === 'string' ? s.notes : '' };
  }
  const created = typeof doc.created_at === 'string' ? Date.parse(doc.created_at) : NaN;
  const ns = w.ns && typeof w.ns === 'object' ? { treatments: (w.ns.treatments ?? []).filter(isNsId), entries: (w.ns.entries ?? []).filter(isNsId) } : undefined;
  return {
    op: w.op,
    kind,
    id,
    uuid,
    at: w.at,
    mgdl: finite(w.mgdl) ? w.mgdl : undefined,
    set,
    ns,
    createdAt: Number.isFinite(created) ? created : w.at,
  };
}

/** The document that carries a request to Nightscout. */
export function requestDoc(r: SiteRequest, now: number): Record<string, unknown> {
  return { eventType: REQUEST_EVENT, enteredBy: 'xDrip-web', created_at: new Date(now).toISOString(), [REQUEST_FIELD]: { v: 1, ...r } };
}

export function deleteEntryRequest(t: Treatment): SiteRequest {
  return { op: 'delete', kind: 'treatment', id: t.nsId ?? undefined, uuid: t.uuid ?? null, at: t.timestamp };
}

export function changeEntryRequest(t: Treatment, set: ChangeSet): SiteRequest {
  return { op: 'update', kind: 'treatment', id: t.nsId ?? undefined, uuid: t.uuid ?? null, at: t.timestamp, set };
}

export function deleteMeterRequest(m: MeterReading): SiteRequest {
  return {
    op: 'delete',
    kind: 'bloodtest',
    at: m.timestamp,
    mgdl: Math.round(m.mmol * MGDL),
    ns: { treatments: m.nsTreatmentIds ?? [], entries: m.nsEntryIds ?? [] },
  };
}

const isTarget = (r: SiteRequest, t: Treatment): boolean => (!!r.id && r.id === t.nsId) || (!!r.uuid && r.uuid === t.uuid);

function isMeterTarget(r: SiteRequest, m: MeterReading): boolean {
  const ids = [...(r.ns?.treatments ?? []), ...(r.ns?.entries ?? [])];
  if (ids.some((id) => m.nsTreatmentIds?.includes(id) || m.nsEntryIds?.includes(id))) return true;
  return r.mgdl !== undefined && Math.abs(m.timestamp - r.at) <= 90_000 && Math.abs(m.mmol * MGDL - r.mgdl) <= 3;
}

/** Entries and finger-sticks as they are once the master has carried out the waiting requests (oldest first). */
export function applyRequests(
  entries: readonly Treatment[],
  meter: readonly MeterReading[],
  requests: readonly PendingRequest[],
): { entries: Treatment[]; meter: MeterReading[] } {
  let e = [...entries];
  let m = [...meter];
  for (const r of [...requests].sort((a, b) => a.createdAt - b.createdAt)) {
    if (r.kind === 'bloodtest') {
      m = m.filter((x) => !isMeterTarget(r, x));
    } else if (r.op === 'delete') {
      e = e.filter((t) => !isTarget(r, t));
    } else if (r.set) {
      const s = r.set;
      e = e.map((t) => (isTarget(r, t) ? { ...t, timestamp: s.timestamp, carbs: s.carbs, insulin: s.insulin, insulinJSON: '[]', notes: s.notes || null } : t));
    }
  }
  return { entries: e.sort(byTimestampAsc), meter: m };
}
