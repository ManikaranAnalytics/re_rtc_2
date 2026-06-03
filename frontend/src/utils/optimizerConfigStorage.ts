import {
  JUNE_DATES,
  PSP_DEFAULT_MAX_CHARGE_MW,
  PSP_DEFAULT_MAX_DISCHARGE_MW,
  PSP_DEFAULT_MIN_DISPATCH_MW,
  PSP_MAX_CAPACITY_MWH,
  PSP_SLIDER_MAX_CHARGE_MW,
  PSP_SLIDER_MAX_DISCHARGE_MW,
  PSP_SLIDER_MAX_MIN_DISPATCH_MW,
} from './constants';
import type { CurtailmentSegment } from '../types';

const STORAGE_KEY = 'hindalco-optimizer-config';

export interface PersistedOptimizerConfig {
  selectedDate: string;
  wtgCount: number;
  solarAc: number;
  rtcCommitment: number;
  maxSocMwh: number;
  maxChargeMw: number;
  maxDischargeMw: number;
  minDispatchMw: number;
  curtailmentEnabled: boolean;
  // Segment-based curtailment (new). Legacy start/end kept for migration only.
  curtailmentSegments: CurtailmentSegment[];
  curtailmentStart: number;  // legacy — used only if curtailmentSegments absent in stored JSON
  curtailmentEnd: number;    // legacy
  roundtripLoss: number;
  initialSocMwh: number;
  carryFromDate: string | null;
  prevDayChargeSchedule: number[] | null;
  blockOverrides: Record<number, { wind_mw: string; solar_mw: string }>;
}

export const DEFAULT_OPTIMIZER_CONFIG: PersistedOptimizerConfig = {
  selectedDate: '2026-06-01',
  wtgCount: 15,
  solarAc: 60,
  rtcCommitment: 15,
  maxSocMwh: 360,
  maxChargeMw: PSP_DEFAULT_MAX_CHARGE_MW,
  maxDischargeMw: PSP_DEFAULT_MAX_DISCHARGE_MW,
  minDispatchMw: PSP_DEFAULT_MIN_DISPATCH_MW,
  curtailmentEnabled: true,
  curtailmentSegments: [{ startBlock: 37, endBlock: 64, maxMw: 0 }],
  curtailmentStart: 37,  // legacy fallback
  curtailmentEnd: 64,    // legacy fallback
  roundtripLoss: 20,
  initialSocMwh: 0,
  carryFromDate: null,
  prevDayChargeSchedule: null,
  blockOverrides: {},
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitize(raw: Record<string, unknown>): PersistedOptimizerConfig {
  const d = DEFAULT_OPTIMIZER_CONFIG;
  const date =
    typeof raw.selectedDate === 'string' && JUNE_DATES.includes(raw.selectedDate)
      ? raw.selectedDate
      : d.selectedDate;

  let blockOverrides = d.blockOverrides;
  if (isRecord(raw.blockOverrides)) {
    blockOverrides = {};
    for (const [key, val] of Object.entries(raw.blockOverrides)) {
      const block = parseInt(key, 10);
      if (block < 1 || block > 96 || !isRecord(val)) continue;
      blockOverrides[block] = {
        wind_mw: typeof val.wind_mw === 'string' ? val.wind_mw : '',
        solar_mw: typeof val.solar_mw === 'string' ? val.solar_mw : '',
      };
    }
  }

  let prevDayChargeSchedule: number[] | null = null;
  if (Array.isArray(raw.prevDayChargeSchedule) && raw.prevDayChargeSchedule.length === 96) {
    const nums = raw.prevDayChargeSchedule.map(x => (typeof x === 'number' ? x : NaN));
    if (nums.every(n => !Number.isNaN(n))) prevDayChargeSchedule = nums;
  }

  const carryFromDate =
    typeof raw.carryFromDate === 'string' && JUNE_DATES.includes(raw.carryFromDate)
      ? raw.carryFromDate
      : raw.carryFromDate === null
        ? null
        : d.carryFromDate;

  // -- Segment migration -------------------------------------------------------
  // If stored JSON has no curtailmentSegments but has the old start/end keys,
  // auto-migrate to a single full-curtailment segment for backward compat.
  let curtailmentSegments: CurtailmentSegment[];
  if (Array.isArray(raw.curtailmentSegments) && raw.curtailmentSegments.length > 0) {
    curtailmentSegments = (raw.curtailmentSegments as unknown[]).reduce<CurtailmentSegment[]>((acc, item) => {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>).startBlock === 'number' &&
        typeof (item as Record<string, unknown>).endBlock   === 'number' &&
        typeof (item as Record<string, unknown>).maxMw      === 'number'
      ) {
        const seg = item as Record<string, number>;
        if (seg.endBlock > seg.startBlock && seg.maxMw >= 0) {
          acc.push({ startBlock: seg.startBlock, endBlock: seg.endBlock, maxMw: seg.maxMw });
        }
      }
      return acc;
    }, []);
    if (curtailmentSegments.length === 0) curtailmentSegments = d.curtailmentSegments;
  } else {
    // Migration: build from legacy start/end fields
    const legacyStart = typeof raw.curtailmentStart === 'number' ? raw.curtailmentStart : d.curtailmentStart;
    const legacyEnd   = typeof raw.curtailmentEnd   === 'number' ? raw.curtailmentEnd   : d.curtailmentEnd;
    curtailmentSegments = [{ startBlock: legacyStart, endBlock: legacyEnd, maxMw: 0 }];
  }

  return {
    selectedDate: date,
    wtgCount: clamp(typeof raw.wtgCount === 'number' ? raw.wtgCount : d.wtgCount, 1, 59),
    solarAc: clamp(typeof raw.solarAc === 'number' ? raw.solarAc : d.solarAc, 5, 175),
    rtcCommitment: clamp(typeof raw.rtcCommitment === 'number' ? raw.rtcCommitment : d.rtcCommitment, 1, 300),
    maxSocMwh: clamp(typeof raw.maxSocMwh === 'number' ? raw.maxSocMwh : d.maxSocMwh, 10, PSP_MAX_CAPACITY_MWH),
    maxChargeMw: clamp(typeof raw.maxChargeMw === 'number' ? raw.maxChargeMw : d.maxChargeMw, 0, PSP_SLIDER_MAX_CHARGE_MW),
    maxDischargeMw: clamp(typeof raw.maxDischargeMw === 'number' ? raw.maxDischargeMw : d.maxDischargeMw, 0, PSP_SLIDER_MAX_DISCHARGE_MW),
    minDispatchMw: clamp(typeof raw.minDispatchMw === 'number' ? raw.minDispatchMw : d.minDispatchMw, 0, PSP_SLIDER_MAX_MIN_DISPATCH_MW),
    curtailmentEnabled: typeof raw.curtailmentEnabled === 'boolean' ? raw.curtailmentEnabled : d.curtailmentEnabled,
    curtailmentSegments,
    curtailmentStart: clamp(typeof raw.curtailmentStart === 'number' ? raw.curtailmentStart : d.curtailmentStart, 1, 96),
    curtailmentEnd:   clamp(typeof raw.curtailmentEnd   === 'number' ? raw.curtailmentEnd   : d.curtailmentEnd,   1, 96),
    roundtripLoss: clamp(typeof raw.roundtripLoss === 'number' ? raw.roundtripLoss : d.roundtripLoss, 10, 30),
    initialSocMwh: clamp(typeof raw.initialSocMwh === 'number' ? raw.initialSocMwh : d.initialSocMwh, 0, PSP_MAX_CAPACITY_MWH),
    carryFromDate,
    prevDayChargeSchedule,
    blockOverrides,
  };
}

export function loadOptimizerConfig(): PersistedOptimizerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIMIZER_CONFIG };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { ...DEFAULT_OPTIMIZER_CONFIG };
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_OPTIMIZER_CONFIG };
  }
}

export function saveOptimizerConfig(config: PersistedOptimizerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Quota exceeded or private browsing — ignore
  }
}

export function clearOptimizerConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
