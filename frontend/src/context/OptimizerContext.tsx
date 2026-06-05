import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  ScheduleResponse, RTCRangeData, RawForecastRow, GenEdit, BlockData, SummaryData,
  CurtailmentSegment, PspDischargeSegment,
} from '../types';
import { BASE_URL, JUNE_DATES } from '../utils/constants';
import {
  loadOptimizerConfig,
  saveOptimizerConfig,
  type PersistedOptimizerConfig,
} from '../utils/optimizerConfigStorage';
import { lookupWindMW } from '../utils/powerCurve';

/* ───────────────────── Context Type ───────────────────── */

interface OptimizerContextValue {
  // Config
  selectedDate: string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  wtgCount: number;
  setWtgCount: React.Dispatch<React.SetStateAction<number>>;
  solarAc: number;
  setSolarAc: React.Dispatch<React.SetStateAction<number>>;
  rtcCommitment: number;
  setRtcCommitment: React.Dispatch<React.SetStateAction<number>>;
  maxSocMwh: number;
  setMaxSocMwh: React.Dispatch<React.SetStateAction<number>>;
  maxChargeMw: number;
  setMaxChargeMw: React.Dispatch<React.SetStateAction<number>>;
  maxDischargeMw: number;
  setMaxDischargeMw: React.Dispatch<React.SetStateAction<number>>;
  minDispatchMw: number;
  setMinDispatchMw: React.Dispatch<React.SetStateAction<number>>;

  // Curtailment — segment-based
  curtailmentEnabled: boolean;
  setCurtailmentEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  curtailmentSegments: CurtailmentSegment[];
  setCurtailmentSegments: React.Dispatch<React.SetStateAction<CurtailmentSegment[]>>;
  // Legacy kept for backward compat (generation table curtail_flag overlay)
  curtailmentStart: number;
  curtailmentEnd: number;

  // PSP Discharge Curtailment
  pspDischargeSegments: PspDischargeSegment[];
  setPspDischargeSegments: React.Dispatch<React.SetStateAction<PspDischargeSegment[]>>;

  // PSP
  roundtripLoss: number;
  setRoundtripLoss: React.Dispatch<React.SetStateAction<number>>;

  // Sidebar
  sideTab: 'config' | 'data';
  setSideTab: React.Dispatch<React.SetStateAction<'config' | 'data'>>;
  blockOverrides: Record<number, { wind_mw: string; solar_mw: string }>;
  setBlockOverrides: React.Dispatch<React.SetStateAction<Record<number, { wind_mw: string; solar_mw: string }>>>;

  // API state
  scheduleData: ScheduleResponse | null;
  loading: boolean;
  error: string;

  // RTC Range
  rtcRange: RTCRangeData | null;
  rangeLoading: boolean;
  rangeExpanded: boolean;
  setRangeExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // Carry forward
  initialSocMwh: number;
  setInitialSocMwh: React.Dispatch<React.SetStateAction<number>>;
  prevDayChargeSchedule: number[] | null;
  carryFromDate: string | null;

  // Modal
  socModalOpen: boolean;
  setSocModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Raw forecast
  rawForecast: RawForecastRow[];

  // Gen table
  genTableEdits: Record<number, GenEdit>;
  setGenTableEdits: React.Dispatch<React.SetStateAction<Record<number, GenEdit>>>;
  genTableExpanded: boolean;
  setGenTableExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // Derived
  blocks: BlockData[];
  summary: SummaryData | undefined;

  // Handlers
  handleRollToNextDay: () => void;
  handleClearCarry: () => void;
}

const OptimizerContext = createContext<OptimizerContextValue | null>(null);

/* ───────────────────── Hook ───────────────────── */

export function useOptimizer(): OptimizerContextValue {
  const ctx = useContext(OptimizerContext);
  if (!ctx) throw new Error('useOptimizer must be used within <OptimizerProvider>');
  return ctx;
}

/* ───────────────────── Provider ───────────────────── */

export function OptimizerProvider({ children }: { children: React.ReactNode }) {
  const [savedConfig] = useState(loadOptimizerConfig);

  // Config state (restored from localStorage on first load)
  const [selectedDate, setSelectedDate] = useState(savedConfig.selectedDate);
  const [wtgCount, setWtgCount] = useState(savedConfig.wtgCount);
  const [solarAc, setSolarAc] = useState(savedConfig.solarAc);
  const [rtcCommitment, setRtcCommitment] = useState(savedConfig.rtcCommitment);
  const [maxSocMwh, setMaxSocMwh] = useState(savedConfig.maxSocMwh);
  const [maxChargeMw, setMaxChargeMw] = useState(savedConfig.maxChargeMw);
  const [maxDischargeMw, setMaxDischargeMw] = useState(savedConfig.maxDischargeMw);
  const [minDispatchMw, setMinDispatchMw] = useState(savedConfig.minDispatchMw);

  // Curtailment config
  const [curtailmentEnabled, setCurtailmentEnabled] = useState(savedConfig.curtailmentEnabled);
  const [curtailmentSegments, setCurtailmentSegments] = useState<CurtailmentSegment[]>(savedConfig.curtailmentSegments);
  // Legacy: kept so rawForecast overlay still works (derived from first segment)
  const curtailmentStart = curtailmentSegments.length > 0 ? curtailmentSegments[0].startBlock : 37;
  const curtailmentEnd   = curtailmentSegments.length > 0 ? curtailmentSegments[0].endBlock   : 64;

  // PSP Discharge Curtailment
  const [pspDischargeSegments, setPspDischargeSegments] = useState<PspDischargeSegment[]>(savedConfig.pspDischargeSegments);

  // PSP loss %
  const [roundtripLoss, setRoundtripLoss] = useState(savedConfig.roundtripLoss);

  // Active sidebar tab
  const [sideTab, setSideTab] = useState<'config' | 'data'>('config');

  // Per-block editable overrides
  const [blockOverrides, setBlockOverrides] = useState(savedConfig.blockOverrides);

  // API response state
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // RTC Range suggestion state
  const [rtcRange, setRtcRange] = useState<RTCRangeData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeExpanded, setRangeExpanded] = useState(true);

  // Carry-forward state
  const [initialSocMwh, setInitialSocMwh] = useState(savedConfig.initialSocMwh);
  const [prevDayChargeSchedule, setPrevDayChargeSchedule] = useState<number[] | null>(
    savedConfig.prevDayChargeSchedule,
  );
  const [carryFromDate, setCarryFromDate] = useState<string | null>(savedConfig.carryFromDate);

  const skipPersistRef = useRef(true);

  const persistConfig = useCallback((): PersistedOptimizerConfig => {
    const config: PersistedOptimizerConfig = {
      selectedDate,
      wtgCount,
      solarAc,
      rtcCommitment,
      maxSocMwh,
      maxChargeMw,
      maxDischargeMw,
      minDispatchMw,
      curtailmentEnabled,
      curtailmentSegments,
      curtailmentStart,
      curtailmentEnd,
      roundtripLoss,
      initialSocMwh,
      carryFromDate,
      prevDayChargeSchedule,
      blockOverrides,
      pspDischargeSegments,
    };
    saveOptimizerConfig(config);
    return config;
  }, [
    selectedDate, wtgCount, solarAc, rtcCommitment,
    maxSocMwh, maxChargeMw, maxDischargeMw, minDispatchMw,
    curtailmentEnabled, curtailmentSegments, roundtripLoss,
    initialSocMwh, carryFromDate, prevDayChargeSchedule, blockOverrides,
    pspDischargeSegments,
  ]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    persistConfig();
  }, [persistConfig]);

  useEffect(() => {
    const onBeforeUnload = () => persistConfig();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      persistConfig();
    };
  }, [persistConfig]);

  // SoC detail modal
  const [socModalOpen, setSocModalOpen] = useState(false);

  // Raw forecast data
  const [rawForecast, setRawForecast] = useState<RawForecastRow[]>([]);

  // Generation table edits
  const [genTableEdits, setGenTableEdits] = useState<Record<number, GenEdit>>({});
  const [genTableExpanded, setGenTableExpanded] = useState(true);

  // ── Build block_overrides list for API ──
  const buildOverridesList = useCallback(() => {
    const fromGenTable: Record<number, { wind_mw?: number; solar_mw?: number }> = {};
    Object.entries(genTableEdits).forEach(([blockStr, edit]) => {
      const block = parseInt(blockStr);
      const row = rawForecast.find(r => r.block === block);
      if (!row) return;
      const entry: { wind_mw?: number; solar_mw?: number } = {};
      if (edit.wind_speed !== undefined && edit.wind_speed !== '') {
        const spd = parseFloat(edit.wind_speed);
        if (!isNaN(spd)) entry.wind_mw = lookupWindMW(spd, wtgCount);
      }
      if (edit.solar_mw !== undefined && edit.solar_mw !== '') {
        const sol = parseFloat(edit.solar_mw);
        if (!isNaN(sol)) entry.solar_mw = sol;
      }
      if (Object.keys(entry).length > 0) fromGenTable[block] = entry;
    });

    const fromLegacy: Record<number, { wind_mw?: number; solar_mw?: number }> = {};
    Object.entries(blockOverrides).forEach(([blockStr, v]) => {
      const block = parseInt(blockStr);
      const entry: { wind_mw?: number; solar_mw?: number } = {};
      if (v.wind_mw !== '') entry.wind_mw = parseFloat(v.wind_mw);
      if (v.solar_mw !== '') entry.solar_mw = parseFloat(v.solar_mw);
      if (Object.keys(entry).length > 0) fromLegacy[block] = entry;
    });

    const merged = { ...fromLegacy, ...fromGenTable };
    return Object.entries(merged).map(([block, v]) => ({ block: parseInt(block), ...v }));
  }, [blockOverrides, genTableEdits, rawForecast, wtgCount]);

  // ── Fetch schedule on state change ──
  useEffect(() => {
    const fetchSchedule = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${BASE_URL}/api/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: selectedDate,
            wtg_count: wtgCount,
            solar_ac_mw: solarAc,
            rtc_commitment_mw: rtcCommitment,
            curtailment_enabled: curtailmentEnabled,
            curtailment_segments: curtailmentSegments,
            roundtrip_loss_pct: roundtripLoss,
            min_compliance_ratio: 0.50,
            max_soc_mwh: maxSocMwh,
            max_charge_mw: maxChargeMw,
            max_discharge_mw: maxDischargeMw,
            min_dispatch_mw: minDispatchMw,
            block_overrides: buildOverridesList(),
            initial_soc_mwh: initialSocMwh,
            prev_day_charge_schedule: prevDayChargeSchedule,
            psp_discharge_segments: pspDischargeSegments.length > 0 ? pspDischargeSegments : null,
          })
        });
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const errBody = await response.json();
            if (Array.isArray(errBody.detail)) {
              detail = errBody.detail.map((d: { msg?: string; loc?: string[] }) =>
                d.loc ? `${d.loc.join('.')}: ${d.msg}` : d.msg
              ).join('; ');
            } else if (typeof errBody.detail === 'string') {
              detail = errBody.detail;
            }
          } catch { /* ignore parse errors */ }
          throw new Error(detail);
        }
        const data: ScheduleResponse = await response.json();
        setScheduleData(data);
      } catch (err: unknown) {
        console.error("Failed to fetch schedule data:", err);
        const message = err instanceof Error ? err.message : String(err);
        const isNetwork =
          err instanceof TypeError ||
          message.toLowerCase().includes('failed to fetch') ||
          message.toLowerCase().includes('network');
        setError(
          isNetwork
            ? "Could not connect to the optimization backend. Please ensure the FastAPI server is running."
            : `Schedule request failed: ${message}`
        );
      } finally {
        setLoading(false);
      }
    };

    const handler = setTimeout(() => { fetchSchedule(); }, 150);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, rtcCommitment, curtailmentEnabled, curtailmentSegments, roundtripLoss, maxSocMwh, maxChargeMw, maxDischargeMw, minDispatchMw, initialSocMwh, prevDayChargeSchedule, pspDischargeSegments, buildOverridesList]);

  // ── Roll to next day ──
  const handleRollToNextDay = useCallback(() => {
    if (!scheduleData) return;
    const nextDate = JUNE_DATES[JUNE_DATES.indexOf(selectedDate) + 1];
    if (!nextDate) return;
    const endSoc = scheduleData.summary.end_soc_mwh;
    const todayCharges = scheduleData.carry_forward?.today_charge_schedule ?? null;
    setCarryFromDate(selectedDate);
    setInitialSocMwh(endSoc);
    setPrevDayChargeSchedule(todayCharges);
    setSelectedDate(nextDate);
  }, [scheduleData, selectedDate]);

  // ── Clear carry-forward ──
  const handleClearCarry = useCallback(() => {
    setInitialSocMwh(0.0);
    setPrevDayChargeSchedule(null);
    setCarryFromDate(null);
  }, []);

  // ── Fetch RTC Range ──
  useEffect(() => {
    const fetchRange = async () => {
      setRangeLoading(true);
      try {
        const response = await fetch(`${BASE_URL}/api/rtc-range`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: selectedDate,
            wtg_count: wtgCount,
            solar_ac_mw: solarAc,
            curtailment_enabled: curtailmentEnabled,
            curtailment_segments: curtailmentSegments,
            roundtrip_loss_pct: roundtripLoss,
            min_compliance_ratio: 0.50,
            max_soc_mwh: maxSocMwh,
            max_charge_mw: maxChargeMw,
            max_discharge_mw: maxDischargeMw,
            min_dispatch_mw: minDispatchMw,
            initial_soc_mwh: initialSocMwh,
            block_overrides: buildOverridesList(),
            psp_discharge_segments: pspDischargeSegments.length > 0 ? pspDischargeSegments : null,
          })
        });
        if (response.ok) {
          const data: RTCRangeData = await response.json();
          setRtcRange(data);
        }
      } catch (e) {
        console.warn('RTC range fetch failed:', e);
      } finally {
        setRangeLoading(false);
      }
    };
    const handler = setTimeout(fetchRange, 300);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, curtailmentEnabled, curtailmentSegments, roundtripLoss, maxSocMwh, maxChargeMw, maxDischargeMw, minDispatchMw, initialSocMwh, pspDischargeSegments, buildOverridesList]);

  // ── Fetch raw forecast ──
  useEffect(() => {
    const fetchRaw = async () => {
      try {
        const params = new URLSearchParams({
          wtg_count: String(wtgCount),
          solar_ac_mw: String(solarAc),
        });
        const response = await fetch(`${BASE_URL}/api/generation/${selectedDate}?${params.toString()}`);
        if (response.ok) {
          const data: RawForecastRow[] = await response.json();
          // Apply curtail_flag overlay using segments (first matching segment wins)
          const withCurtail = data.map(row => {
            if (!curtailmentEnabled) return { ...row, curtail_flag: false };
            const seg = curtailmentSegments.find(
              s => s.startBlock <= row.block && row.block <= s.endBlock
            );
            return { ...row, curtail_flag: seg !== undefined && seg.maxMw === 0 };
          });
          setRawForecast(withCurtail);
          setGenTableEdits({});
        }
      } catch (e) {
        console.warn('Raw forecast fetch failed:', e);
      }
    };
    const handler = setTimeout(fetchRaw, 200);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, curtailmentEnabled, curtailmentSegments]);

  // ── Derived ──
  const blocks = scheduleData?.blocks || [];
  const summary = scheduleData?.summary;

  const value: OptimizerContextValue = {
    selectedDate, setSelectedDate,
    wtgCount, setWtgCount,
    solarAc, setSolarAc,
    rtcCommitment, setRtcCommitment,
    maxSocMwh, setMaxSocMwh,
    maxChargeMw, setMaxChargeMw,
    maxDischargeMw, setMaxDischargeMw,
    minDispatchMw, setMinDispatchMw,
    curtailmentEnabled, setCurtailmentEnabled,
    curtailmentSegments, setCurtailmentSegments,
    curtailmentStart,
    curtailmentEnd,
    pspDischargeSegments, setPspDischargeSegments,
    roundtripLoss, setRoundtripLoss,
    sideTab, setSideTab,
    blockOverrides, setBlockOverrides,
    scheduleData, loading, error,
    rtcRange, rangeLoading, rangeExpanded, setRangeExpanded,
    initialSocMwh, setInitialSocMwh,
    prevDayChargeSchedule, carryFromDate,
    socModalOpen, setSocModalOpen,
    rawForecast,
    genTableEdits, setGenTableEdits,
    genTableExpanded, setGenTableExpanded,
    blocks, summary,
    handleRollToNextDay, handleClearCarry,
  };

  return (
    <OptimizerContext.Provider value={value}>
      {children}
    </OptimizerContext.Provider>
  );
}
