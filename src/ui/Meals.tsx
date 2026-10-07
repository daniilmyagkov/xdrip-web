/** Приёмы: meals with their carb ratio, filter by meal type, tap for the card, swipe left to change or delete. */
import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { classify, type MealType } from '../core/classifier';
import { humanPart, isAutoUk, parseUk } from '../core/notes';
import { estimateMeal, type MealEstimate } from '../core/pull';
import { recentMeals, type Meal } from '../core/roles';
import type { Effective } from '../core/settings';
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import { DAY_MS } from '../core/units';
import type { Connection } from '../ns/client';
import { READINGS_DAYS, type Snapshot } from '../state/store';
import { EntryDetails, type Picked } from './EntryDetails';
import { dayLabel, hhmm, MEAL_LABEL, mmol, num, trim } from './format';

type Filter = 'ALL' | MealType;
const FILTERS: Array<[Filter, string]> = [
  ['ALL', 'Все'],
  ['BREAKFAST', 'Завтрак'],
  ['LUNCH', 'Обед'],
  ['DINNER', 'Ужин'],
];

export interface Row {
  meal: Meal;
  type: MealType;
  savedUk: number;
  estimate: MealEstimate | null;
}

function rowFor(data: Snapshot, meal: Meal, settings: Effective, now: number): Row {
  const t = meal.treatment;
  const readingsFrom = now - READINGS_DAYS * DAY_MS + 3 * 3_600_000; // need a pre-meal reading too
  return {
    meal,
    type: classify(t.timestamp, t.notes, settings.mealHours),
    savedUk: parseUk(t.notes),
    estimate: meal.timestamp >= readingsFrom ? estimateMeal(data, t, now, settings) : null,
  };
}

/** The meal card data for an entry tapped on the graph — null when the entry is not a meal of its own. */
export function mealRowFor(data: Snapshot, entry: Treatment, settings: Effective, now: number): Row | null {
  const meal = recentMeals(data.entries, now, 30 * DAY_MS, settings.workoutMs).find((m) => m.treatment.id === entry.id);
  return meal ? rowFor(data, meal, settings, now) : null;
}

/** The newest meal (for the home header), or null. */
export function lastMealRow(data: Snapshot, settings: Effective, now: number): Row | null {
  const meals = recentMeals(data.entries, now, 2 * DAY_MS, settings.workoutMs);
  let newest: Meal | null = null;
  for (const m of meals) if (!newest || m.timestamp > newest.timestamp) newest = m;
  return newest ? rowFor(data, newest, settings, now) : null;
}

export function Meals({ data, settings, now, conn, onChanged }: { data: Snapshot; settings: Effective; now: number; conn: Connection; onChanged: (message: string) => void }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [picked, setPicked] = useState<Picked | null>(null);
  // the row whose «Изменить» / «Удалить» are slid out (one at a time, as in the app)
  const [revealed, setRevealed] = useState<string | null>(null);

  const rows = useMemo<Row[]>(
    () => recentMeals(data.entries, now, 30 * DAY_MS, settings.workoutMs).map((meal) => rowFor(data, meal, settings, now)),
    [data, settings, now],
  );

  const shown = rows.filter((r) => filter === 'ALL' || r.type === filter);

  return (
    <div class="screen">
      <div class="screen-title">Приёмы и УК</div>
      <div class="chips" style={{ marginBottom: '12px' }}>
        {FILTERS.map(([f, label]) => (
          <button class={`chip ${filter === f ? 'on' : ''}`} key={f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div class="empty">Приёмов пищи за последние 30 дней нет</div>
      ) : (
        <div class="stack">
          {shown.map((r) => {
            const entry = r.meal.treatment;
            return (
              <MealRow
                key={entry.id}
                row={r}
                settings={settings}
                revealed={revealed === entry.id}
                onReveal={(on) => setRevealed(on ? entry.id : null)}
                onOpen={() => setPicked({ kind: 'entry', entry })}
                onEdit={() => {
                  setRevealed(null);
                  setPicked({ kind: 'entry', entry, mode: 'edit' });
                }}
                onDelete={() => {
                  setRevealed(null);
                  setPicked({ kind: 'entry', entry, mode: 'delete' });
                }}
              />
            );
          })}
        </div>
      )}
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

export function ukLine(r: Row): { text: string; estimate: boolean } | null {
  if (Number.isFinite(r.savedUk)) return { text: `УК ${num(r.savedUk, 2)} ед/ХЕ`, estimate: false };
  const est = r.estimate;
  if (est?.result.computed) {
    return { text: `≈ УК ${num(est.result.insulinPerBreadUnit, 2)} ед/ХЕ${est.pulled.windowComplete ? '' : ' · оценка'}`, estimate: true };
  }
  return null;
}

/** Width of the slid-out «Изменить» / «Удалить». */
const ACTIONS_W = 176;

interface RowProps {
  row: Row;
  settings: Effective;
  revealed: boolean;
  onReveal: (on: boolean) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** A meal in the list: tap opens its card, a swipe to the left slides out «Изменить» and «Удалить» (as in the app). */
function MealRow({ row, settings, revealed, onReveal, onOpen, onEdit, onDelete }: RowProps) {
  const t = row.meal.treatment;
  const uk = ukLine(row);
  const human = humanPart(t.notes);
  const [drag, setDrag] = useState<number | null>(null);
  const swipe = useRef<{ x: number; y: number; base: number; sideways: boolean; moved: boolean } | null>(null);

  const offset = drag ?? (revealed ? -ACTIONS_W : 0);
  return (
    <div class="swipe-row">
      {/* as in the app: the actions slide in over the card's right edge, the card stays */}
      <div class={`swipe-actions ${drag !== null ? 'dragging' : ''}`} aria-hidden={!revealed} style={{ transform: `translateX(${ACTIONS_W + offset}px)` }}>
        <button class="swipe-edit" onClick={onEdit}>
          Изменить
        </button>
        <button class="swipe-delete" onClick={onDelete}>
          Удалить
        </button>
      </div>
      <div
        class="card tap swipe-front"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY, base: revealed ? -ACTIONS_W : 0, sideways: false, moved: false };
        }}
        onPointerMove={(e) => {
          const s = swipe.current;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (!s.sideways && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            s.sideways = true;
            try {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            } catch {
              /* not a live pointer */
            }
          }
          if (Math.hypot(dx, dy) > 8) s.moved = true;
          if (s.sideways) setDrag(Math.max(-ACTIONS_W, Math.min(0, s.base + dx)));
        }}
        onPointerUp={() => {
          const s = swipe.current;
          if (s?.sideways && drag !== null) onReveal(drag < -ACTIONS_W / 2);
          setDrag(null);
        }}
        onPointerCancel={() => {
          swipe.current = null;
          setDrag(null);
        }}
        onClick={() => {
          const s = swipe.current;
          swipe.current = null;
          if (s?.moved) return; // the end of a swipe, not a tap
          if (revealed) onReveal(false);
          else onOpen();
        }}
      >
        <div class="card-label">
          {MEAL_LABEL[row.type]} · {dayLabel(t.timestamp)} {hhmm(t.timestamp)}
        </div>
        <div class="meal-line" style={{ marginTop: '4px', fontSize: '20px' }}>
          <span>{trim(bolusUnitsOf(t), 2)} ед</span>
          <span class="muted">·</span>
          <span>{trim(t.carbs / settings.gramsPerBreadUnit, 1)} ХЕ</span>
          {human && <span class="small muted">{human}</span>}
        </div>
        {uk && <div class={`meal-uk ${uk.estimate ? 'estimate' : ''}`}>{uk.text}</div>}
      </div>
    </div>
  );
}

const ISF_ORIGIN: Record<string, string> = {
  PINNED: 'задан вручную',
  RULE_OF_100: 'по правилу 100',
  NOTE: 'из заметки',
  PREVIOUS_MEAL: 'как у прошлого приёма',
  NONE: 'нет данных',
};

export function MealCard({ row, settings, now, onClose, children }: { row: Row; settings: Effective; now: number; onClose: () => void; children?: ComponentChildren }) {
  const t = row.meal.treatment;
  const est = row.estimate;
  const p = est?.pulled;
  const r = est?.result;
  const saved = Number.isFinite(row.savedUk);
  const hero = saved ? row.savedUk : r?.computed ? r.insulinPerBreadUnit : NaN;
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label="Карточка приёма">
        <div class="sheet-grip" />
        <div class="row">
          <div class="card-label">
            {MEAL_LABEL[row.type]} · {dayLabel(t.timestamp)} {hhmm(t.timestamp)}
          </div>
          <div class="spacer" />
          <button class="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div class="card" style={{ marginTop: '12px', border: '1px solid rgba(55,200,163,.35)' }}>
          <div class="card-label">Углеводный коэффициент</div>
          <div class="big-number">{Number.isFinite(hero) ? `${num(hero, 2)}` : '—'}</div>
          <div class="lo">ед на 1 ХЕ{r?.computed && Number.isFinite(r.carbGramsPerUnit) && !saved ? ` · ≈ ${num(r.carbGramsPerUnit, 1)} г на 1 ед` : ''}</div>
          <div style={{ marginTop: '8px' }}>
            {saved ? (
              <span class="badge accent">{isAutoUk(t.notes) ? 'рассчитан мастером автоматически' : 'сохранён вручную'}</span>
            ) : p && !p.windowComplete ? (
              <span class="badge warn">оценка · отработка к {hhmm(p.expectedEndTime)}</span>
            ) : r?.computed ? (
              <span class="badge">рассчитан на сайте</span>
            ) : (
              <span class="badge warn">недостаточно данных</span>
            )}
            {r?.status === 'ATYPICAL' && (
              <span class="badge warn" style={{ marginLeft: '6px' }}>
                нетипичный результат
              </span>
            )}
          </div>
        </div>
        {p && r ? (
          <div class="card" style={{ marginTop: '12px' }}>
            <div class="kv">
              <span>СК перед едой → после</span>
              <span>
                {mmol(p.bgStartMmol)}
                {p.bgStartFromMeter ? ' (из пальца)' : ''} → {mmol(p.bgEndMmol)}
              </span>
            </div>
            <div class="kv">
              <span>Изменение СК</span>
              <span>{Number.isFinite(r.bgDeltaMmol) ? `${r.bgDeltaMmol >= 0 ? '+' : '−'}${num(Math.abs(r.bgDeltaMmol), 1)}` : '—'}</span>
            </div>
            <div class="kv">
              <span>Болюс</span>
              <span>{trim(p.bolusUnits, 2)} ед</span>
            </div>
            {p.bolusShare < 0.995 && p.bolusUnits > 0 && (
              <div class="kv">
                <span>действовал до след. приёма</span>
                <span>
                  {Math.round(p.bolusShare * 100)}% → {trim(p.bolusUnits * p.bolusShare, 2)} ед
                </span>
              </div>
            )}
            {p.priorDoses.map((d, i) => (
              <div class="kv" key={`p${i}`}>
                <span>
                  До еды {trim(d.doseUnits, 2)} ед · {d.timestamp ? hhmm(d.timestamp) : ''}
                </span>
                <span>
                  {Math.round((d.effectiveUnits / d.doseUnits) * 100)}% → {trim(d.effectiveUnits, 2)} ед
                </span>
              </div>
            ))}
            {p.supplements.map((s, i) => (
              <div class="kv" key={`s${i}`}>
                <span>
                  Подколка {trim(s.doseUnits, 2)} ед · {s.timestamp ? hhmm(s.timestamp) : ''}
                </span>
                <span>
                  {Math.round((s.effectiveUnits / s.doseUnits) * 100)}% → {trim(s.effectiveUnits, 2)} ед
                </span>
              </div>
            ))}
            <div class="kv">
              <span>Углеводы</span>
              <span>
                {trim(p.carbGrams, 1)} г ({trim(p.carbGrams / settings.gramsPerBreadUnit, 1)} ХЕ)
              </span>
            </div>
            {p.additionalCarbGrams > 0 && (
              <div class="kv">
                <span>из них доедания</span>
                <span>{trim(p.additionalCarbGrams, 1)} г</span>
              </div>
            )}
            <div class="kv">
              <span>ФЧИ</span>
              <span>
                {num(r.isfUsedMmolPerUnit, 2)} · {ISF_ORIGIN[est.isfOrigin]}
              </span>
            </div>
          </div>
        ) : (
          <div class="card muted" style={{ marginTop: '12px' }}>
            Подробный расчёт доступен для приёмов за последние {READINGS_DAYS - 1} дня. Сохранённый УК взят из записи мастера.
          </div>
        )}
        {now < t.timestamp + settings.workoutMs && <div class="caption" style={{ marginTop: '10px' }}>УК сохранится автоматически, когда пройдёт время отработки.</div>}
        {children}
      </div>
    </div>
  );
}
