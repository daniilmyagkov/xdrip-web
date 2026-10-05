/** «Доза перед едой» — port of UkDoseActivity: болюс = ХЕ × УК, коррекция = (СК − цель) / ФЧИ, итого. */
import { useMemo, useState } from 'preact/hooks';
import { forwardDose } from '../core/calculator';
import { classify, classifyTime, type MealType } from '../core/classifier';
import { isfByRuleOf100 } from '../core/insulin';
import { parseUk } from '../core/notes';
import { previousMealIsf } from '../core/roles';
import { averageDailyBolusBeforeDay } from '../core/selection';
import type { Effective } from '../core/settings';
import { bolusUnitsOf } from '../core/treatment';
import { DAY_MS, localMidnight } from '../core/units';
import type { Snapshot } from '../state/store';
import { MEAL_LABEL, mealLabelLower, num, trim } from './format';

const parse = (s: string): number => {
  const v = Number(s.replace(',', '.').trim());
  return Number.isFinite(v) ? v : NaN;
};

export function Dose({ data, settings, now }: { data: Snapshot; settings: Effective; now: number }) {
  const mealType: MealType = classifyTime(now, settings.mealHours);
  const auto = useMemo(() => {
    const last = data.readings[data.readings.length - 1];
    const bg = last && now - last.timestamp < 15 * 60_000 ? last.mmol : NaN;
    const dayStart = localMidnight(now);
    const events = data.entries.map((t) => ({ timestamp: t.timestamp, bolusUnits: bolusUnitsOf(t), attached: false }));
    let isf = isfByRuleOf100(averageDailyBolusBeforeDay(events, dayStart, settings.isfDays));
    if (!Number.isFinite(isf)) isf = previousMealIsf(data.entries, now);
    // newest saved УК of the same meal type, else the newest of any type
    let ukSame = NaN;
    let ukAny = NaN;
    for (let i = data.entries.length - 1; i >= 0; i--) {
      const t = data.entries[i];
      if (!t || t.timestamp > now || now - t.timestamp > 30 * DAY_MS) continue;
      const uk = parseUk(t.notes);
      if (!Number.isFinite(uk)) continue;
      if (!Number.isFinite(ukAny)) ukAny = uk;
      if (!Number.isFinite(ukSame) && classify(t.timestamp, t.notes, settings.mealHours) === mealType) ukSame = uk;
      if (Number.isFinite(ukSame)) break;
    }
    return { bg, isf, uk: Number.isFinite(ukSame) ? ukSame : ukAny, ukSameType: Number.isFinite(ukSame) };
  }, [data, settings, now, mealType]);

  const [amount, setAmount] = useState('');
  const [inGrams, setInGrams] = useState(true);
  const [ukText, setUkText] = useState('');
  const [isfText, setIsfText] = useState('');
  const [bgText, setBgText] = useState('');
  const [targetText, setTargetText] = useState('');

  const bg = bgText ? parse(bgText) : auto.bg;
  const isf = isfText ? parse(isfText) : auto.isf;
  const uk = ukText ? parse(ukText) : auto.uk;
  const target = targetText ? parse(targetText) : settings.defaultTargetMmol;
  const qty = parse(amount);
  const breadUnits = inGrams ? qty / settings.gramsPerBreadUnit : qty;
  const r = forwardDose(bg, target, isf, breadUnits, uk);

  const ph = (v: number, d = 1) => (Number.isFinite(v) ? num(v, d) : 'нет данных');

  return (
    <div class="screen">
      <div class="screen-title">Доза перед едой</div>
      <div class="card">
        <div class="row">
          <label class="field" style={{ marginTop: 0, flex: 1 }}>
            <span>Сколько съедите</span>
            <input class="input input-big" inputMode="decimal" placeholder="0" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
          </label>
        </div>
        <div class="chips" style={{ marginTop: '10px' }}>
          <button class={`chip ${inGrams ? 'on' : ''}`} onClick={() => setInGrams(true)}>
            граммы углеводов
          </button>
          <button class={`chip ${!inGrams ? 'on' : ''}`} onClick={() => setInGrams(false)}>
            ХЕ
          </button>
        </div>
      </div>

      <div class="card" style={{ marginTop: '12px', border: '1px solid rgba(55,200,163,.35)' }}>
        <div class="card-label">Итого</div>
        <div class="big-number">{r.computed ? `${trim(r.totalUnits, 2)} ед` : '—'}</div>
        {r.computed && (
          <div class="lo" style={{ marginTop: '6px' }}>
            на еду {trim(r.mealBolusUnits, 2)} ед · коррекция {r.correctionUnits >= 0 ? '+' : '−'}
            {trim(Math.abs(r.correctionUnits), 2)} ед
          </div>
        )}
        {!r.computed && qty > 0 && (
          <div class="caption">
            {r.needsCarbRatio ? 'Нет сохранённого УК — введите его ниже. ' : ''}
            {r.needsIsf ? 'Нет ФЧИ — введите его ниже. ' : ''}
            {r.needsCurrentBg ? 'Нет свежего сахара — введите его ниже.' : ''}
          </div>
        )}
        {r.totalClampedToZero && <div class="caption">Сахар ниже цели: инсулин не нужен.</div>}
      </div>

      <div class="card" style={{ marginTop: '12px' }}>
        <div class="card-label">Данные для расчёта — можно поправить</div>
        <div class="grid2">
          <label class="field">
            <span>
              УК, ед/ХЕ {auto.ukSameType ? `(${mealLabelLower(mealType)})` : ''}
            </span>
            <input class="input" inputMode="decimal" placeholder={ph(auto.uk, 2)} value={ukText} onInput={(e) => setUkText(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>ФЧИ, ммоль/л на 1 ед</span>
            <input class="input" inputMode="decimal" placeholder={ph(auto.isf, 2)} value={isfText} onInput={(e) => setIsfText(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Сахар сейчас</span>
            <input class="input" inputMode="decimal" placeholder={ph(auto.bg)} value={bgText} onInput={(e) => setBgText(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Цель</span>
            <input class="input" inputMode="decimal" placeholder={num(settings.defaultTargetMmol, 1)} value={targetText} onInput={(e) => setTargetText(e.currentTarget.value)} />
          </label>
        </div>
        <div class="caption" style={{ marginTop: '10px' }}>
          Сейчас {MEAL_LABEL[mealType].toLowerCase()}. Подсказка, а не назначение: решение о дозе принимаете вы.
        </div>
      </div>
    </div>
  );
}
