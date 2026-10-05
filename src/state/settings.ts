/** Carb-ratio settings persisted on this device (defaults = a fresh Android install). */
import { DEFAULT_SETTINGS, type UkSettings } from '../core/settings';

const KEY = 'xdripweb.settings.v1';

export function loadSettings(): UkSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw) as Partial<UkSettings>;
    return { ...DEFAULT_SETTINGS, ...s, mealHours: { ...DEFAULT_SETTINGS.mealHours, ...(s.mealHours ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: UkSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
