import type { ScheduleResponse } from '../types';

const STORAGE_KEY = 'hindalco-multiday-analysis';

export interface PersistedDayResult {
  date: string;
  schedule: ScheduleResponse;
}

export interface PersistedMultiDayState {
  startDate: string;
  numDays: number;
  chartView: 'soc' | 'chargeWindow' | 'dispatch' | 'compliance';
  results: PersistedDayResult[];
  optimalRtcMw: number | null;
  optimalSearchError: string;
}

export function loadMultiDayState(): PersistedMultiDayState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedMultiDayState;
    if (!parsed.startDate || typeof parsed.numDays !== 'number') return null;
    if (!Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMultiDayState(state: PersistedMultiDayState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or private browsing — ignore
  }
}

export function clearMultiDayState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
