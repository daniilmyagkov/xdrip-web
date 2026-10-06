/** Главная: current glucose, trend, graph, today's entries. */
import { useState } from 'preact/hooks';
import { humanPart, isNotMeal, parseUk } from '../core/notes';
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import type { Snapshot } from '../state/store';
import { Chart } from './Chart';
import { arrow, hhmm, minutesAgo, mmol, num, trim } from './format';

const RANGES = [3, 6, 12, 24] as const;
const STALE_MS = 11 * 60_000;

function delta(readings: Snapshot['readings']): number {
  const last = readings[readings.length - 1];
  if (!last) return NaN;
  // compare with the reading ~5 min earlier (works for 1-min and 5-min data alike)
  for (let i = readings.length - 2; i >= 0; i--) {
    const r = readings[i];
    if (r && last.timestamp - r.timestamp >= 4.5 * 60_000) {
      return ((last.mmol - r.mmol) / (last.timestamp - r.timestamp)) * 5 * 60_000;
    }
  }
  return NaN;
}

export function entryText(t: Treatment): string {
  const parts: string[] = [];
  const bolus = bolusUnitsOf(t);
  if (t.carbs > 0) parts.push(`${trim(t.carbs, 1)} г`);
  if (bolus > 0) parts.push(`${trim(bolus, 2)} ед`);
  const human = humanPart(t.notes);
  if (human) parts.push(human);
  if (isNotMeal(t.notes)) parts.push('не учитывать');
  return parts.join(' · ') || 'заметка';
}

export function Home({ data, now, onAdd }: { data: Snapshot; now: number; onAdd: () => void }) {
  const [hours, setHours] = useState<number>(() => Number(localStorage.getItem('xdripweb.hours')) || 6);
  const last = data.readings[data.readings.length - 1];
  const stale = !last || now - last.timestamp > STALE_MS;
  const out = last && (last.mmol > data.thresholds.high || last.mmol < data.thresholds.low);
  const d = delta(data.readings);
  // last 24 h rather than "since midnight", so the list isn't empty right after midnight
  const inDay = (ts: number) => ts >= now - 24 * 3_600_000 && ts <= now + 3_600_000;
  type Row = { ts: number; key: string; entry?: Treatment; meterMmol?: number };
  const recent: Row[] = [
    ...data.entries.filter((t) => inDay(t.timestamp)).map((t): Row => ({ ts: t.timestamp, key: t.id, entry: t })),
    ...data.meter.filter((m) => inDay(m.timestamp)).map((m): Row => ({ ts: m.timestamp, key: `bg${m.timestamp}`, meterMmol: m.mmol })),
  ].sort((a, b) => b.ts - a.ts);
  const midnight = new Date(now).setHours(0, 0, 0, 0);

  const pick = (h: number) => {
    setHours(h);
    try {
      localStorage.setItem('xdripweb.hours', String(h));
    } catch {
      /* ignore */
    }
  };

  return (
    <div class="screen">
      <div class="hero">
        <div class={`hero-value ${stale ? 'stale' : out ? 'out' : ''}`}>{last ? mmol(last.mmol) : '—'}</div>
        <div class="hero-arrow">{last && !stale ? arrow(last.direction) : ''}</div>
        <div class="hero-meta">
          <div>
            <b>{Number.isFinite(d) ? `${d >= 0 ? '+' : '−'}${num(Math.abs(d), 1)}` : ''}</b> ммоль/л
          </div>
          <div class="small">{last ? minutesAgo(last.timestamp, now) : 'нет данных'}</div>
        </div>
      </div>

      <div class="chips" style={{ marginBottom: '8px' }}>
        {RANGES.map((h) => (
          <button class={`chip ${hours === h ? 'on' : ''}`} key={h} onClick={() => pick(h)}>
            {h} ч
          </button>
        ))}
      </div>
      <div class="card" style={{ padding: '6px 4px' }}>
        <Chart readings={data.readings} entries={data.entries} hours={hours} low={data.thresholds.low} high={data.thresholds.high} now={now} />
      </div>

      <div class="screen-title" style={{ fontSize: '17px', marginTop: '20px' }}>
        За сутки
      </div>
      {recent.length === 0 ? (
        <div class="empty">Записей пока нет</div>
      ) : (
        <div class="stack">
          {recent.map((row) => {
            const uk = row.entry ? parseUk(row.entry.notes) : NaN;
            return (
              <div class="card row" key={row.key}>
                <div class="muted" style={{ width: '52px', lineHeight: 1.15 }}>
                  {hhmm(row.ts)}
                  {row.ts < midnight && <div class="small">вчера</div>}
                </div>
                <div style={{ flex: 1 }}>{row.entry ? entryText(row.entry) : `${mmol(row.meterMmol ?? NaN)} ммоль/л · из пальца`}</div>
                {Number.isFinite(uk) && <span class="badge accent">УК {num(uk, 2)}</span>}
              </div>
            );
          })}
        </div>
      )}
      <button class="fab" aria-label="Добавить запись" onClick={onAdd}>
        +
      </button>
    </div>
  );
}
