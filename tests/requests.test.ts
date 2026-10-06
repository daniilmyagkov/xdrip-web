import { describe, expect, it } from 'vitest';
import type { Treatment } from '../src/core/treatment';
import type { MeterReading } from '../src/ns/client';
import {
  applyRequests,
  changeEntryRequest,
  deleteEntryRequest,
  deleteMeterRequest,
  isRequestDoc,
  parseRequest,
  requestDoc,
  type PendingRequest,
} from '../src/ns/requests';

const NS_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NS_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = 1_791_300_000_000;
const t = (nsId: string, timestamp: number, carbs: number, insulin: number, notes: string | null = null, uuid: string | null = null): Treatment => ({
  id: uuid ?? nsId,
  nsId,
  uuid,
  timestamp,
  carbs,
  insulin,
  notes,
});
const pending = (doc: Record<string, unknown>): PendingRequest => {
  const p = parseRequest(doc);
  if (!p) throw new Error('not a request');
  return p;
};

describe('requests to change existing entries', () => {
  it('travel as a document the master can read, and back', () => {
    const doc = requestDoc(changeEntryRequest(t(NS_A, NOW, 50, 6), { timestamp: NOW + 60_000, carbs: 45, insulin: 5, notes: '#ужин' }), NOW + 1000);
    expect(doc.eventType).toBe('xDrip-web');
    expect(isRequestDoc(doc)).toBe(true);
    const p = pending(doc);
    expect(p).toMatchObject({ op: 'update', kind: 'treatment', id: NS_A, at: NOW, set: { timestamp: NOW + 60_000, carbs: 45, insulin: 5, notes: '#ужин' } });
    expect(p.createdAt).toBe(NOW + 1000);
  });

  it('a malformed request is ignored (as the master ignores it)', () => {
    expect(parseRequest({ xdripWeb: { op: 'wipe', id: NS_A, at: NOW } })).toBeNull();
    expect(parseRequest({ xdripWeb: { op: 'delete', at: NOW } })).toBeNull();
    expect(parseRequest({ xdripWeb: { op: 'update', id: NS_A, at: NOW, set: { timestamp: NOW, carbs: -1, insulin: 1 } } })).toBeNull();
    expect(parseRequest({ xdripWeb: { op: 'update', kind: 'bloodtest', at: NOW, mgdl: 100 } })).toBeNull();
    expect(isRequestDoc({ eventType: '<none>', carbs: 20 })).toBe(false);
  });

  it('show at once: a deleted entry is gone, a changed one has its new values', () => {
    const entries = [t(NS_A, NOW, 50, 6), t(NS_B, NOW + 3_600_000, 0, 2, null, '0b6f2a3c-1111-4222-8333-944455556666')];
    const del = pending(requestDoc(deleteEntryRequest(entries[0] as Treatment), NOW + 10));
    const chg = pending(requestDoc(changeEntryRequest(entries[1] as Treatment, { timestamp: NOW + 3_660_000, carbs: 0, insulin: 2.5, notes: '' }), NOW + 20));
    const out = applyRequests(entries, [], [chg, del]);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ nsId: NS_B, timestamp: NOW + 3_660_000, insulin: 2.5, notes: null });
  });

  it('a finger-stick is removed by its documents, or by time and value', () => {
    const meter: MeterReading[] = [
      { timestamp: NOW, mmol: 6.5, nsTreatmentIds: [NS_A], nsEntryIds: [] },
      { timestamp: NOW + 7_200_000, mmol: 8.1, nsEntryIds: [NS_B] },
    ];
    const byIds = pending(requestDoc(deleteMeterRequest(meter[0] as MeterReading), NOW + 5));
    expect(byIds.mgdl).toBe(117);
    expect(applyRequests([], meter, [byIds]).meter).toHaveLength(1);
    const byValue = pending({ xdripWeb: { op: 'delete', kind: 'bloodtest', at: NOW + 7_230_000, mgdl: 146 } });
    expect(applyRequests([], meter, [byValue]).meter.map((m) => m.mmol)).toEqual([6.5]);
  });
});
