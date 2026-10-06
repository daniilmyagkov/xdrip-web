/** Ещё: carb-ratio settings (same meaning and defaults as on Android), connection, sign out. */
import type { JSX } from 'preact';
import { DEFAULT_SETTINGS, type UkSettings } from '../core/settings';
import type { Connection } from '../ns/client';

interface Props {
  conn: Connection;
  settings: UkSettings;
  onSettings: (s: UkSettings) => void;
  onSignOut: () => void;
}

/** Commits on blur / Enter; an invalid entry snaps back to the current value. */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): JSX.Element {
  const shown = String(value).replace('.', ',');
  return (
    <label class="field">
      <span>{label}</span>
      <input
        class="input"
        inputMode="decimal"
        value={shown}
        onChange={(e) => {
          const v = Number(e.currentTarget.value.replace(',', '.').trim());
          if (Number.isFinite(v) && v > 0) onChange(v);
          else e.currentTarget.value = shown;
        }}
      />
    </label>
  );
}

export function More({ conn, settings, onSettings, onSignOut }: Props) {
  const set = <K extends keyof UkSettings>(k: K, v: UkSettings[K]) => onSettings({ ...settings, [k]: v });
  const setHour = (k: 'breakfast' | 'lunch' | 'dinner', v: number) => onSettings({ ...settings, mealHours: { ...settings.mealHours, [k]: Math.round(v) % 24 } });
  const host = conn.baseUrl.replace(/^https?:\/\//, '');

  return (
    <div class="screen">
      <div class="screen-title">Ещё</div>

      <div class="card">
        <div class="card-label">Подключено к Nightscout</div>
        <div style={{ marginTop: '4px', wordBreak: 'break-all' }}>{host}</div>
        <div class="caption">{conn.token ? 'С ключом доступа: можно вносить еду и инсулин.' : 'Без ключа: только просмотр.'}</div>
      </div>

      <div class="card" style={{ marginTop: '12px' }}>
        <div class="card-label">Настройки расчёта УК</div>
        <div class="caption">Должны совпадать с настройками в приложении на мастере.</div>
        <div class="grid2">
          <NumberField label="Граммов в 1 ХЕ" value={settings.gramsPerBreadUnit} onChange={(v) => set('gramsPerBreadUnit', v)} />
          <NumberField label="СК_отработки, ч" value={settings.workoutHours} onChange={(v) => set('workoutHours', v)} />
          <label class="field">
            <span>ФЧИ по правилу 100</span>
            <select class="input" value={settings.isfMethod} onChange={(e) => set('isfMethod', e.currentTarget.value === 'last_day' ? 'last_day' : 'average')}>
              <option value="average">среднее</option>
              <option value="last_day">прошлые сутки</option>
            </select>
          </label>
          {settings.isfMethod === 'average' ? (
            <NumberField label="Сколько дней" value={settings.isfAvgDays} onChange={(v) => set('isfAvgDays', Math.round(v))} />
          ) : (
            <div />
          )}
        </div>

        <div class="card-label" style={{ marginTop: '18px' }}>
          Целевой сахар перед едой, ммоль/л
        </div>
        <div class="grid2">
          <NumberField label="от" value={settings.targetPreMealMin} onChange={(v) => set('targetPreMealMin', v)} />
          <NumberField label="до" value={settings.targetPreMealMax} onChange={(v) => set('targetPreMealMax', v)} />
        </div>

        <div class="card-label" style={{ marginTop: '18px' }}>
          Приёмы пищи начинаются с (час)
        </div>
        <div class="grid3">
          <NumberField label="Завтрак" value={settings.mealHours.breakfast} onChange={(v) => setHour('breakfast', v)} />
          <NumberField label="Обед" value={settings.mealHours.lunch} onChange={(v) => setHour('lunch', v)} />
          <NumberField label="Ужин" value={settings.mealHours.dinner} onChange={(v) => setHour('dinner', v)} />
        </div>
        <button class="btn btn-ghost btn-block" style={{ marginTop: '18px' }} onClick={() => onSettings(structuredClone(DEFAULT_SETTINGS))}>
          Вернуть значения по умолчанию
        </button>
      </div>

      <div class="card" style={{ marginTop: '12px' }}>
        <div class="card-label">Установить как приложение</div>
        <div class="caption" style={{ marginTop: '4px' }}>
          iPhone (Safari): «Поделиться» → «На экран „Домой“». Android (Chrome): меню ⋮ → «Добавить на главный экран».
        </div>
      </div>

      <button class="btn btn-danger btn-block" style={{ marginTop: '18px' }} onClick={onSignOut}>
        Выйти
      </button>
      <div class="caption" style={{ textAlign: 'center', marginTop: '12px' }}>
        xDrip Redesign Web · {__APP_VERSION__}
      </div>
    </div>
  );
}
