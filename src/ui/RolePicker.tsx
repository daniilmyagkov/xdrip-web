/** Доедание / Отдельно / Не учитывать + Завтрак / Обед / Ужин — same radios as the Android UkMealRolePicker. */
import type { MealType } from '../core/classifier';
import type { Role } from '../core/notes';
import { hhmm, MEAL_LABEL, mealLabelLower } from './format';

interface Props {
  role: Role;
  type: MealType;
  anchorTime: number;
  anchorType: MealType | null;
  onRole: (r: Role) => void;
  onType: (t: MealType) => void;
}

const ROLES: Array<[Role, string]> = [
  ['ATTACHED', 'Доедание'],
  ['SEPARATE', 'Отдельно'],
  ['NOT_MEAL', 'Не учитывать'],
];
const TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER'];

export function RolePicker({ role, type, anchorTime, anchorType, onRole, onType }: Props) {
  return (
    <div class="card" style={{ background: 'var(--surface-hi)' }}>
      <div class="radios" role="radiogroup" aria-label="Что это за еда">
        {ROLES.map(([r, label]) => (
          <label class="radio" key={r}>
            <input type="radio" name="role" checked={role === r} onChange={() => onRole(r)} />
            {label}
          </label>
        ))}
      </div>
      {role === 'ATTACHED' && anchorTime > 0 && (
        <div class="caption">
          к приёму в {hhmm(anchorTime)}
          {anchorType ? ` (${mealLabelLower(anchorType)})` : ''}
        </div>
      )}
      {role === 'NOT_MEAL' && <div class="caption">не участвует в расчёте УК</div>}
      {role === 'SEPARATE' && (
        <div class="radios" role="radiogroup" aria-label="Тип приёма" style={{ marginTop: '4px' }}>
          {TYPES.map((t) => (
            <label class="radio" key={t}>
              <input type="radio" name="type" checked={type === t} onChange={() => onType(t)} />
              {MEAL_LABEL[t]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
