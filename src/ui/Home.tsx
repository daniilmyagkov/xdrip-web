/**
 * Главная — the phone's home screen: the newest meal with its УК on the left and the glucose on the
 * right, then the graph (scroll / zoom / tap a meal) with the green «+» on it, and the 24 h strip.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { humanPart, isNotMeal } from '../core/notes';
import type { Effective } from '../core/settings';
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import type { Snapshot } from '../state/store';
import { DEFAULT_SPAN, futureMargin, liveView, type View } from './chartModel';
import { arrow, dayLabel, hhmm, MEAL_LABEL, minutesAgo, mmol, num, trim } from './format';
import { GlucoseChart } from './GlucoseChart';
import { lastMealRow, MealCard, mealRowFor, type Row } from './Meals';
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

export function Home({ data, settings, now, onAdd }: { data: Snapshot; settings: Effective; now: number; onAdd: () => void }) {
  const [follow, setFollow] = useState(true);
  const [manual, setManual] = useState<View>(() => liveView(loadSpan(), now));
  const view: View = follow ? liveView(manual.span, now) : manual;
  const [card, setCard] = useState<Row | null>(null);
  const [info, setInfo] = useState<Treatment | null>(null);

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

  useEffect(() => {
    if (!info) return;
    const id = setTimeout(() => setInfo(null), 6000);
    return () => clearTimeout(id);
  }, [info]);

  const pick = (t: Treatment) => {
    const row = mealRowFor(data, t, settings, now);
    if (row) setCard(row);
    else setInfo(t);
  };

  const lm = lastMeal ? headerUk(lastMeal) : null;
  const lmCarbs = lastMeal ? (lastMeal.estimate?.pulled.carbGrams ?? lastMeal.meal.carbGrams) : 0;

  return (
    <div class="home">
      <div class="home-head">
        {lastMeal && lm ? (
          <button class="last-meal" onClick={() => setCard(lastMeal)}>
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
          onPickEntry={pick}
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

      {card && <MealCard row={card} settings={settings} now={now} onClose={() => setCard(null)} />}
      {info && (
        <div class="backdrop" onClick={(e) => e.target === e.currentTarget && setInfo(null)}>
          <div class="sheet" role="dialog" aria-label="Запись">
            <div class="sheet-grip" />
            <div class="card-label">
              {dayLabel(info.timestamp, now)} {hhmm(info.timestamp)}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '6px' }}>{entryText(info)}</div>
            <div class="caption" style={{ marginTop: '8px' }}>
              {bolusUnitsOf(info) > 0 && info.carbs <= 0
                ? 'Укол без еды — учтён в УК ближайших приёмов по таблице действия инсулина.'
                : info.carbs > 0
                  ? 'Доедание — учтено в УК своего приёма.'
                  : ''}
            </div>
            <button class="btn btn-ghost btn-block" style={{ marginTop: '14px' }} onClick={() => setInfo(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
