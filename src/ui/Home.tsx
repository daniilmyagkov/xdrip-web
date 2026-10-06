/**
 * Главная — the phone's home screen: the newest meal with its УК on the left and the glucose on the
 * right, then the graph (scroll / zoom / tap a meal) with the green «+» on it, and the 24 h strip.
 */
import { useMemo, useState } from 'preact/hooks';
import type { Effective } from '../core/settings';
import type { Connection } from '../ns/client';
import type { Snapshot } from '../state/store';
import { DEFAULT_SPAN, futureMargin, liveView, type View } from './chartModel';
import { EntryDetails, type Picked } from './EntryDetails';
import { arrow, dayLabel, hhmm, MEAL_LABEL, minutesAgo, mmol, num, trim } from './format';
import { GlucoseChart } from './GlucoseChart';
import { lastMealRow, type Row } from './Meals';
import { Overview } from './Overview';

const STALE_MS = 11 * 60_000;
const SPAN_KEY = 'xdripweb.span';

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

function loadSpan(): number {
  try {
    const v = Number(localStorage.getItem(SPAN_KEY));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SPAN;
  } catch {
    return DEFAULT_SPAN;
  }
}

/** УК shown for a meal: the live recomputation while possible, else the saved one (as on the phone). */
function headerUk(row: Row): { uk: number; estimate: boolean; until: number } {
  const est = row.estimate;
  if (est?.result.computed && Number.isFinite(est.result.insulinPerBreadUnit)) {
    return { uk: est.result.insulinPerBreadUnit, estimate: !est.pulled.windowComplete, until: est.pulled.expectedEndTime };
  }
  return { uk: row.savedUk, estimate: false, until: 0 };
}

interface Props {
  data: Snapshot;
  settings: Effective;
  now: number;
  conn: Connection;
  onAdd: () => void;
  /** A change was sent to Nightscout: say so and reload. */
  onChanged: (message: string) => void;
}

export function Home({ data, settings, now, conn, onAdd, onChanged }: Props) {
  const [follow, setFollow] = useState(true);
  const [manual, setManual] = useState<View>(() => liveView(loadSpan(), now));
  const view: View = follow ? liveView(manual.span, now) : manual;
  const [picked, setPicked] = useState<Picked | null>(null);

  const last = data.readings[data.readings.length - 1];
  const stale = !last || now - last.timestamp > STALE_MS;
  const out = last && (last.mmol > data.thresholds.high || last.mmol < data.thresholds.low);
  const d = delta(data.readings);
  const oldest = data.readings[0]?.timestamp ?? now - 24 * 3_600_000;
  const lastMeal = useMemo(() => lastMealRow(data, settings, now), [data, settings, now]);

  const onView = (v: View) => {
    // back at the right edge → follow new data again
    const atNow = v.end >= now + futureMargin(v.span) - 60_000;
    setFollow(atNow);
    setManual(v);
    try {
      localStorage.setItem(SPAN_KEY, String(Math.round(v.span)));
    } catch {
      /* ignore */
    }
  };

  const lm = lastMeal ? headerUk(lastMeal) : null;
  const lmCarbs = lastMeal ? (lastMeal.estimate?.pulled.carbGrams ?? lastMeal.meal.carbGrams) : 0;

  return (
    <div class="home">
      <div class="home-head">
        {lastMeal && lm ? (
          <button class="last-meal" onClick={() => setPicked({ kind: 'entry', entry: lastMeal.meal.treatment })}>
            <div class="last-meal-title">
              {MEAL_LABEL[lastMeal.type]} · {dayLabel(lastMeal.meal.timestamp, now) === 'сегодня' ? '' : 'вчера '}
              {hhmm(lastMeal.meal.timestamp)} · {trim(lmCarbs / settings.gramsPerBreadUnit, 1)} ХЕ
            </div>
            <div class="last-meal-uk">
              {Number.isFinite(lm.uk) ? `${lm.estimate ? '≈ ' : ''}УК ${num(lm.uk, 2)}` : 'УК —'}
              {lm.estimate && lm.until > 0 && <span class="last-meal-until">до {hhmm(lm.until)}</span>}
            </div>
          </button>
        ) : (
          <div class="last-meal" />
        )}
        <div class="glu">
          <div class="glu-row">
            <div class={`glu-value ${stale ? 'stale' : out ? 'out' : ''}`}>{last ? mmol(last.mmol) : '—'}</div>
            <div class="glu-arrow">{last && !stale ? arrow(last.direction) : ''}</div>
          </div>
          <div class="glu-meta">
            {Number.isFinite(d) ? `${d >= 0 ? '+' : '−'}${num(Math.abs(d), 1)} ммоль/л · ` : ''}
            {last ? minutesAgo(last.timestamp, now) : 'нет данных'}
          </div>
        </div>
      </div>

      <div class="home-chart">
        <GlucoseChart
          readings={data.readings}
          entries={data.entries}
          meter={data.meter}
          low={data.thresholds.low}
          high={data.thresholds.high}
          target={settings.defaultTargetMmol}
          now={now}
          oldest={oldest}
          view={view}
          onView={onView}
          onPickEntry={(entry) => setPicked({ kind: 'entry', entry })}
          onPickMeter={(meter) => setPicked({ kind: 'meter', meter })}
        >
          <button class="chart-fab" aria-label="Добавить запись" onClick={onAdd}>
            +
          </button>
          {!follow ? (
            <button class="chip on chart-now" onClick={() => setFollow(true)}>
              Сейчас →
            </button>
          ) : null}
        </GlucoseChart>
      </div>

      <Overview
        readings={data.readings}
        entries={data.entries}
        low={data.thresholds.low}
        high={data.thresholds.high}
        now={now}
        oldest={oldest}
        view={view}
        onView={onView}
      />

      {picked && (
        <EntryDetails
          picked={picked}
          conn={conn}
          data={data}
          settings={settings}
          now={now}
          onClose={() => setPicked(null)}
          onDone={(message) => {
            setPicked(null);
            onChanged(message);
          }}
        />
      )}
    </div>
  );
}
