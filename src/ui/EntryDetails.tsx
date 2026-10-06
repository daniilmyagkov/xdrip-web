/**
 * What a tap on an entry opens — on the graph, in the header and in «Приёмы» — with the actions the
 * Android app has: Доедание / Отдельно / Не учитывать and the meal type («Сохранить»), «Изменить»,
 * «Удалить»; a lone injection can be made a подколка of the previous meal or a meal of its own; a
 * finger-stick can be deleted. A change goes to Nightscout as a request the master carries out
 * (ns/requests.ts) — every browser shows it at once, the phones within about a minute.
 */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { classify, classifyTime, type MealType } from '../core/classifier';
import {
  humanPart,
  isAttachedToPreviousMeal,
  isForcedSeparate,
  isNotMeal,
  parseBgStart,
  pinnedIsf,
  setAttached,
  setBgStart,
  setMealType,
  setPinnedIsf,
  setRole,
  type Role,
} from '../core/notes';
import { Attachments, defaultForNewEntry } from '../core/roles';
import type { Effective } from '../core/settings';
import { bolusUnitsOf, type Treatment } from '../core/treatment';
import { ns, NsError, type Connection, type MeterReading } from '../ns/client';
import { changeEntryRequest, deleteEntryRequest, deleteMeterRequest, type SiteRequest } from '../ns/requests';
import type { Snapshot } from '../state/store';
import { dayLabel, hhmm, mmol, trim } from './format';
import { MealCard, mealRowFor } from './Meals';
import { RolePicker } from './RolePicker';

export type Picked = { kind: 'entry'; entry: Treatment; mode?: 'view' | 'edit' | 'delete' } | { kind: 'meter'; meter: MeterReading };

interface Ctx {
  conn: Connection;
  data: Snapshot;
  settings: Effective;
  now: number;
  /** A change was sent: close and say so. */
  onDone: (message: string) => void;
  onClose: () => void;
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

/** Sends a request; the error text for the person, or null when it went through. */
async function send(conn: Connection, req: SiteRequest): Promise<string | null> {
  try {
    await ns.sendRequest(conn, req);
    return null;
  } catch (e) {
    if (e instanceof NsError && (e.status === 401 || e.status === 403)) {
      return 'Нет права вносить изменения. Отсканируйте свежий QR-код с мастера: «Ещё» → «Выйти» → «Сканировать QR-код».';
    }
    return e instanceof NsError ? e.message : 'Не удалось отправить';
  }
}

export function EntryDetails({ picked, ...ctx }: { picked: Picked } & Ctx) {
  const start = picked.kind === 'entry' ? (picked.mode ?? 'view') : 'view';
  const [mode, setMode] = useState(start);
  // from the card «Отмена» goes back to it; from a swipe in «Приёмы» it closes
  const back = () => (start === 'view' ? setMode('view') : ctx.onClose());

  if (picked.kind === 'meter') {
    return mode === 'delete' ? (
      <ConfirmDelete
        what="этот замер"
        onCancel={() => setMode('view')}
        onConfirm={() => send(ctx.conn, deleteMeterRequest(picked.meter))}
        onDone={() => ctx.onDone('Замер удалён')}
      />
    ) : (
      <MeterCard meter={picked.meter} onClose={ctx.onClose} onDelete={() => setMode('delete')} />
    );
  }
  const entry = picked.entry;
  if (mode === 'edit') return <EditSheet entry={entry} {...ctx} onCancel={back} />;
  if (mode === 'delete') {
    return (
      <ConfirmDelete what="эту запись" onCancel={back} onConfirm={() => send(ctx.conn, deleteEntryRequest(entry))} onDone={() => ctx.onDone('Удалено')} />
    );
  }
  const row = mealRowFor(ctx.data, entry, ctx.settings, ctx.now);
  const actions = <EntryActions entry={entry} {...ctx} onEdit={() => setMode('edit')} onDelete={() => setMode('delete')} />;
  return row ? (
    <MealCard row={row} settings={ctx.settings} now={ctx.now} onClose={ctx.onClose}>
      {actions}
    </MealCard>
  ) : (
    <EntryCard entry={entry} data={ctx.data} settings={ctx.settings} now={ctx.now} onClose={ctx.onClose}>
      {actions}
    </EntryCard>
  );
}

/** The app's tap menu, under the card: role and type, a lone injection's подколка switch, «Изменить», «Удалить». */
function EntryActions({ entry, conn, data, settings, onDone, onEdit, onDelete }: Ctx & { entry: Treatment; onEdit: () => void; onDelete: () => void }) {
  const attachments = useMemo(() => Attachments.resolve(data.entries, settings.workoutMs), [data.entries, settings.workoutMs]);
  const bolus = bolusUnitsOf(entry);
  const currentRole = attachments.role(entry);
  const currentType = classify(entry.timestamp, entry.notes, settings.mealHours);
  const auto = useMemo(
    () => defaultForNewEntry(data.entries, entry.timestamp - 1, entry.carbs, bolus, settings.workoutMs, settings.mealHours),
    [data.entries, entry, bolus, settings],
  );
  const [role, setRoleState] = useState<Role>(currentRole);
  const [type, setType] = useState<MealType>(currentType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = role !== currentRole || (role === 'SEPARATE' && type !== currentType);

  async function saveNotes(notes: string, message: string) {
    setBusy(true);
    setError(null);
    const fail = await send(conn, changeEntryRequest(entry, { timestamp: entry.timestamp, carbs: entry.carbs, insulin: bolus, notes }));
    if (fail) {
      setError(fail);
      setBusy(false);
    } else {
      onDone(message);
    }
  }

  // as the app's «Сохранить»: the role is pinned, the type only when it differs from the time of day
  const roleNotes = () => {
    const n = setRole(entry.notes, role);
    return setMealType(n, role === 'SEPARATE' && type !== classifyTime(entry.timestamp, settings.mealHours) ? type : null);
  };
  const attached = attachments.isAttached(entry);

  return (
    <div class="entry-actions">
      {entry.carbs > 0 && (
        <div style={{ marginTop: '12px' }}>
          <RolePicker
            role={role}
            type={type}
            anchorTime={auto.anchorMealTime}
            anchorType={auto.anchorMealType}
            onRole={setRoleState}
            onType={setType}
          />
          {changed && (
            <button class="btn btn-primary btn-block" style={{ marginTop: '10px' }} disabled={busy} onClick={() => void saveNotes(roleNotes(), 'Сохранено')}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          )}
        </div>
      )}
      {entry.carbs <= 0 && bolus > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div class="caption">{attached ? 'Подколка к предыдущему приёму' : 'Отдельный укол'}</div>
          <button class="btn btn-ghost btn-block" style={{ marginTop: '6px' }} disabled={busy} onClick={() => void saveNotes(setAttached(entry.notes, !attached), 'Сохранено')}>
            {attached ? 'Сделать отдельным приёмом' : 'Отметить как подколку к предыдущему приёму'}
          </button>
        </div>
      )}
      {error && (
        <div class="banner error" style={{ marginTop: '10px' }}>
          {error}
        </div>
      )}
      <div class="row" style={{ marginTop: '12px' }}>
        <button class="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={onEdit}>
          Изменить
        </button>
        <button class="btn btn-danger" style={{ flex: 1 }} disabled={busy} onClick={onDelete}>
          Удалить
        </button>
      </div>
    </div>
  );
}

/** A tapped entry that is not a meal of its own: injection, доедание, carbs not counted, note. */
function EntryCard({ entry, data, settings, now, onClose, children }: { entry: Treatment; data: Snapshot; settings: Effective; now: number; onClose: () => void; children?: ComponentChildren }) {
  const attachments = useMemo(() => Attachments.resolve(data.entries, settings.workoutMs), [data.entries, settings.workoutMs]);
  const bolus = bolusUnitsOf(entry);
  const label =
    entry.carbs > 0 ? (attachments.isNotMeal(entry) ? 'Не учитывается' : 'Доедание') : bolus > 0 ? (attachments.isAttached(entry) ? 'Подколка' : 'Укол') : 'Заметка';
  const caption =
    entry.carbs > 0
      ? attachments.isNotMeal(entry)
        ? 'Не участвует в расчёте УК.'
        : 'Доедание — учтено в УК своего приёма.'
      : bolus > 0
        ? 'Укол без еды — учтён в УК ближайших приёмов по таблице действия инсулина.'
        : '';
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label="Запись">
        <div class="sheet-grip" />
        <div class="row">
          <div class="card-label">
            {label} · {dayLabel(entry.timestamp, now)} {hhmm(entry.timestamp)}
          </div>
          <div class="spacer" />
          <button class="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '8px' }}>{entryText(entry)}</div>
        {caption && (
          <div class="caption" style={{ marginTop: '6px' }}>
            {caption}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function MeterCard({ meter, onClose, onDelete }: { meter: MeterReading; onClose: () => void; onDelete: () => void }) {
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label="Сахар из пальца">
        <div class="sheet-grip" />
        <div class="row">
          <div class="card-label">
            Сахар из пальца · {dayLabel(meter.timestamp)} {hhmm(meter.timestamp)}
          </div>
          <div class="spacer" />
          <button class="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div style={{ fontSize: '28px', fontWeight: 900, marginTop: '8px' }}>{mmol(meter.mmol)} ммоль/л</div>
        <button class="btn btn-danger btn-block" style={{ marginTop: '16px' }} onClick={onDelete}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function ConfirmDelete({ what, onCancel, onConfirm, onDone }: { what: string; onCancel: () => void; onConfirm: () => Promise<string | null>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    const fail = await onConfirm();
    if (fail) {
      setError(fail);
      setBusy(false);
    } else {
      onDone();
    }
  }
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div class="sheet" role="alertdialog" aria-label="Удалить">
        <div class="sheet-grip" />
        <div style={{ fontSize: '20px', fontWeight: 800 }}>Удалить {what}?</div>
        <div class="caption" style={{ marginTop: '6px' }}>
          Пропадёт с графика и из расчёта УК — на сайте, на телефоне-мастере и у фолловеров.
        </div>
        {error && (
          <div class="banner error" style={{ marginTop: '10px' }}>
            {error}
          </div>
        )}
        <div class="row" style={{ marginTop: '16px' }}>
          <button class="btn btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={onCancel}>
            Отмена
          </button>
          <button class="btn btn-danger" style={{ flex: 1 }} disabled={busy} onClick={() => void go()}>
            {busy ? 'Удаляю…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  );
}

const parse = (s: string): number => {
  const v = Number(s.replace(',', '.').trim());
  return Number.isFinite(v) ? v : NaN;
};
const fmt = (v: number): string => (Number.isFinite(v) && v > 0 ? String(Number(v.toFixed(2))).replace('.', ',') : '');

/** "YYYY-MM-DDTHH:MM" in local time, for a datetime-local field. */
function localInput(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The app's «Изменить приём»: date and time, carbs, insulin, СК перед едой, ФЧИ, role and type, note. */
function EditSheet({ entry, conn, data, settings, onDone, onCancel }: Ctx & { entry: Treatment; onCancel: () => void }) {
  const attachments = useMemo(() => Attachments.resolve(data.entries, settings.workoutMs), [data.entries, settings.workoutMs]);
  const startRole = attachments.role(entry);
  const startType = classify(entry.timestamp, entry.notes, settings.mealHours);
  const [when, setWhen] = useState(() => localInput(entry.timestamp));
  const [carbs, setCarbs] = useState(fmt(entry.carbs));
  const [insulin, setInsulin] = useState(fmt(bolusUnitsOf(entry)));
  const [bgStart, setBgStartText] = useState(fmt(parseBgStart(entry.notes)));
  const [isf, setIsf] = useState(fmt(pinnedIsf(entry.notes)));
  const [note, setNote] = useState(humanPart(entry.notes));
  const [role, setRoleState] = useState<Role>(startRole);
  const [type, setType] = useState<MealType>(startType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ts = Date.parse(when); // local time
  const c = carbs.trim() === '' ? 0 : parse(carbs);
  const u = insulin.trim() === '' ? 0 : parse(insulin);
  const bg = bgStart.trim() === '' ? NaN : parse(bgStart);
  const f = isf.trim() === '' ? NaN : parse(isf);
  const auto = useMemo(
    () => defaultForNewEntry(data.entries, Number.isFinite(ts) ? ts - 1 : entry.timestamp - 1, c, u, settings.workoutMs, settings.mealHours),
    [data.entries, ts, entry.timestamp, c, u, settings],
  );
  const problem = !Number.isFinite(ts)
    ? 'Укажите дату и время'
    : !(c >= 0 && c <= 1000)
      ? 'Проверьте углеводы'
      : !(u >= 0 && u <= 100)
        ? 'Проверьте инсулин'
        : bgStart.trim() !== '' && !(bg >= 1 && bg <= 33)
          ? 'СК перед едой — от 1 до 33 ммоль/л'
          : isf.trim() !== '' && !(f > 0 && f <= 50)
            ? 'Проверьте ФЧИ'
            : c <= 0 && u <= 0 && note.trim() === ''
              ? 'Пустую запись лучше удалить'
              : null;

  async function save() {
    // as the app: the note is rebuilt from its text; the saved УК is dropped and the master recomputes it
    let n = setBgStart(note.trim(), bg);
    n = setPinnedIsf(n, f);
    if (role !== startRole) n = setRole(n, role);
    else if (isNotMeal(entry.notes)) n = setRole(n, 'NOT_MEAL');
    else if (isForcedSeparate(entry.notes)) n = setRole(n, 'SEPARATE');
    else if (isAttachedToPreviousMeal(entry.notes)) n = setRole(n, 'ATTACHED');
    n = setMealType(n, role === 'SEPARATE' && type !== classifyTime(ts, settings.mealHours) ? type : null);
    setBusy(true);
    setError(null);
    const fail = await send(conn, changeEntryRequest(entry, { timestamp: ts, carbs: c, insulin: u, notes: n }));
    if (fail) {
      setError(fail);
      setBusy(false);
    } else {
      onDone('Сохранено');
    }
  }

  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div class="sheet" role="dialog" aria-label="Изменить запись">
        <div class="sheet-grip" />
        <div class="row">
          <div class="screen-title" style={{ margin: 0 }}>
            Изменить
          </div>
          <div class="spacer" />
          <button class="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={onCancel}>
            Отмена
          </button>
        </div>
        <label class="field">
          <span>Дата и время</span>
          <input class="input" type="datetime-local" value={when} onInput={(e) => setWhen(e.currentTarget.value)} />
        </label>
        <div class="grid2">
          <label class="field">
            <span>Углеводы, г</span>
            <input class="input" inputMode="decimal" placeholder="0" value={carbs} onInput={(e) => setCarbs(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Инсулин, ед</span>
            <input class="input" inputMode="decimal" placeholder="0" value={insulin} onInput={(e) => setInsulin(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>СК перед едой, ммоль/л</span>
            <input class="input" inputMode="decimal" placeholder="авто" value={bgStart} onInput={(e) => setBgStartText(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>ФЧИ, ммоль/л на 1 ед</span>
            <input class="input" inputMode="decimal" placeholder="авто" value={isf} onInput={(e) => setIsf(e.currentTarget.value)} />
          </label>
        </div>
        {c > 0 && (
          <div class="field">
            <RolePicker role={role} type={type} anchorTime={auto.anchorMealTime} anchorType={auto.anchorMealType} onRole={setRoleState} onType={setType} />
          </div>
        )}
        <label class="field">
          <span>Заметка</span>
          <input class="input" value={note} placeholder="необязательно" onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        {error ? (
          <div class="banner error" style={{ marginTop: '12px' }}>
            {error}
          </div>
        ) : (
          problem && (
            <div class="caption" style={{ marginTop: '12px', color: 'var(--warn)' }}>
              {problem}
            </div>
          )
        )}
        <button class="btn btn-primary btn-block" style={{ marginTop: '18px' }} disabled={busy || problem !== null} onClick={() => void save()}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
