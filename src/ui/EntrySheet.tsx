/**
 * Add food / insulin / note. Written to Nightscout; the master xDrip downloads it within about a
 * minute and passes it on to every other follower, like an entry typed on an Android follower.
 */
import { useMemo, useState } from 'preact/hooks';
import { classifyTime, type MealType } from '../core/classifier';
import { setMealType, setRole, type Role } from '../core/notes';
import { defaultForNewEntry } from '../core/roles';
import type { Effective } from '../core/settings';
import type { Treatment } from '../core/treatment';
import { HOUR_MS } from '../core/units';
import { ns, NsError, type Connection } from '../ns/client';
import { hhmm } from './format';
import { RolePicker } from './RolePicker';

interface Props {
  conn: Connection;
  entries: readonly Treatment[];
  settings: Effective;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const parse = (s: string): number => {
  const v = Number(s.replace(',', '.').trim());
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** HH:MM today, or yesterday when that would be more than an hour in the future (Android's rule). */
function timestampFor(hhmmValue: string, now: number): { ts: number; yesterday: boolean } {
  const [h, m] = hhmmValue.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  let ts = d.getTime();
  const yesterday = ts - now > HOUR_MS;
  if (yesterday) ts -= 24 * HOUR_MS;
  return { ts, yesterday };
}

export function EntrySheet({ conn, entries, settings, onClose, onSaved }: Props) {
  const [openedAt] = useState(() => Date.now());
  const [carbs, setCarbs] = useState('');
  const [insulin, setInsulin] = useState('');
  const [bgText, setBgText] = useState('');
  const [time, setTime] = useState(() => hhmm(openedAt));
  const [note, setNote] = useState('');
  const [roleOverride, setRoleOverride] = useState<Role | null>(null);
  const [typeOverride, setTypeOverride] = useState<MealType | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = parse(carbs);
  const u = parse(insulin);
  const bg = parse(bgText);
  const bgOk = bg === 0 || (bg >= 1 && bg <= 33);
  const { ts, yesterday } = timestampFor(time, openedAt);
  const auto = useMemo(() => defaultForNewEntry(entries, ts, c, u, settings.workoutMs, settings.mealHours), [entries, ts, c, u, settings]);
  const autoType = classifyTime(ts, settings.mealHours);
  const role = roleOverride ?? auto.role;
  const type = typeOverride ?? autoType;
  const canSave = (c > 0 || u > 0 || bg > 0 || note.trim() !== '') && bgOk && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    // markers only where the user overrode the automatic choice — keeps notes clean (as on Android)
    let notes = note.trim();
    if (c > 0 && roleOverride !== null && roleOverride !== auto.role) notes = setRole(notes, roleOverride);
    if (c > 0 && role === 'SEPARATE' && type !== autoType) notes = setMealType(notes, type);
    try {
      await ns.addTreatment(conn, { timestamp: ts, carbs: c, insulin: u, notes, bgMmol: bg });
      onSaved('Сохранено. На телефоны придёт в течение 1–2 минут');
      onClose();
    } catch (e) {
      if (e instanceof NsError && (e.status === 401 || e.status === 403)) {
        setError('Нет права вносить записи. Отсканируйте свежий QR-код с мастера: «Ещё» → «Выйти» → «Сканировать QR-код».');
      } else {
        setError(e instanceof NsError ? e.message : 'Не удалось сохранить');
      }
      setSaving(false);
    }
  }

  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label="Добавить запись">
        <div class="sheet-grip" />
        <div class="row">
          <div class="screen-title" style={{ margin: 0 }}>
            Новая запись
          </div>
          <div class="spacer" />
          <button class="btn btn-ghost" style={{ padding: '8px 14px' }} onClick={onClose}>
            Отмена
          </button>
        </div>
        <div class="grid3" style={{ marginTop: '14px' }}>
          <label class="field" style={{ marginTop: 0 }}>
            <span>Углеводы, г</span>
            <input class="input input-big" inputMode="decimal" placeholder="0" value={carbs} onInput={(e) => setCarbs(e.currentTarget.value)} />
          </label>
          <label class="field" style={{ marginTop: 0 }}>
            <span>Инсулин, ед</span>
            <input class="input input-big" inputMode="decimal" placeholder="0" value={insulin} onInput={(e) => setInsulin(e.currentTarget.value)} />
          </label>
          <label class="field" style={{ marginTop: 0 }}>
            <span>Сахар из пальца</span>
            <input class="input input-big" inputMode="decimal" placeholder="—" value={bgText} onInput={(e) => setBgText(e.currentTarget.value)} />
          </label>
        </div>
        {!bgOk && <div class="caption" style={{ color: 'var(--danger)' }}>Сахар — в ммоль/л, от 1 до 33</div>}
        <label class="field">
          <span>Время</span>
          <div class="row">
            <input class="input" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} style={{ maxWidth: '150px' }} />
            <span class="lo">
              в {time}
              {yesterday ? ' (вчера)' : ''}
            </span>
          </div>
        </label>
        {c > 0 && (
          <div class="field">
            <RolePicker
              role={role}
              type={type}
              anchorTime={auto.anchorMealTime}
              anchorType={auto.anchorMealType}
              onRole={setRoleOverride}
              onType={setTypeOverride}
            />
          </div>
        )}
        <label class="field">
          <span>Заметка</span>
          <input class="input" value={note} placeholder="необязательно" onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        {error && (
          <div class="banner error" style={{ marginTop: '12px' }}>
            {error}
          </div>
        )}
        <button class="btn btn-primary btn-block" style={{ marginTop: '18px' }} disabled={!canSave} onClick={save}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
