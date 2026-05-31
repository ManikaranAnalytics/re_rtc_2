import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type {
  ScheduleResponse, RTCRangeData, RawForecastRow, GenEdit, BlockData, SummaryData,
} from '../types';
import { BASE_URL, JUNE_DATES } from '../utils/constants';
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

  // Curtailment
  curtailmentEnabled: boolean;
  setCurtailmentEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  curtailmentStart: number;
  setCurtailmentStart: React.Dispatch<React.SetStateAction<number>>;
  curtailmentEnd: number;
  setCurtailmentEnd: React.Dispatch<React.SetStateAction<number>>;

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
  // Config state
  const [selectedDate, setSelectedDate] = useState("2026-06-01");
  const [wtgCount, setWtgCount] = useState(15);
  const [solarAc, setSolarAc] = useState(60);
  const [rtcCommitment, setRtcCommitment] = useState(15.0);
  const [maxSocMwh, setMaxSocMwh] = useState(360.0);

  // Curtailment config
  const [curtailmentEnabled, setCurtailmentEnabled] = useState(true);
  const [curtailmentStart, setCurtailmentStart] = useState(37);
  const [curtailmentEnd, setCurtailmentEnd] = useState(64);

  // PSP loss %
  const [roundtripLoss, setRoundtripLoss] = useState(20.0);

  // Active sidebar tab
  const [sideTab, setSideTab] = useState<'config' | 'data'>('config');

  // Per-block editable overrides
  const [blockOverrides, setBlockOverrides] = useState<Record<number, { wind_mw: string; solar_mw: string }>>({});

  // API response state
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // RTC Range suggestion state
  const [rtcRange, setRtcRange] = useState<RTCRangeData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeExpanded, setRangeExpanded] = useState(true);

  // Carry-forward state
  const [initialSocMwh, setInitialSocMwh] = useState(0.0);
  const [prevDayChargeSchedule, setPrevDayChargeSchedule] = useState<number[] | null>(null);
  const [carryFromDate, setCarryFromDate] = useState<string | null>(null);

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
            curtailment_start_block: curtailmentStart,
            curtailment_end_block: curtailmentEnd,
            roundtrip_loss_pct: roundtripLoss,
            min_compliance_ratio: 0.75,
            max_soc_mwh: maxSocMwh,
            min_dispatch_mw: 6,
            block_overrides: buildOverridesList(),
            initial_soc_mwh: initialSocMwh,
            prev_day_charge_schedule: prevDayChargeSchedule,
          })
        });
        if (!response.ok) throw new Error(`Error: ${response.statusText}`);
        const data: ScheduleResponse = await response.json();
        setScheduleData(data);
      } catch (err: any) {
        console.error("Failed to fetch schedule data:", err);
        setError("Could not connect to the optimization backend. Please ensure the FastAPI server is running.");
      } finally {
        setLoading(false);
      }
    };

    const handler = setTimeout(() => { fetchSchedule(); }, 150);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, rtcCommitment, curtailmentEnabled, curtailmentStart, curtailmentEnd, roundtripLoss, maxSocMwh, initialSocMwh, prevDayChargeSchedule, buildOverridesList]);

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
            curtailment_start_block: curtailmentStart,
            curtailment_end_block: curtailmentEnd,
            roundtrip_loss_pct: roundtripLoss,
            min_compliance_ratio: 0.75,
            max_soc_mwh: maxSocMwh,
            min_dispatch_mw: 6,
            initial_soc_mwh: initialSocMwh,
            block_overrides: buildOverridesList(),
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
  }, [selectedDate, wtgCount, solarAc, curtailmentEnabled, curtailmentStart, curtailmentEnd, roundtripLoss, maxSocMwh, initialSocMwh, buildOverridesList]);

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
          const withCurtail = data.map(row => ({
            ...row,
            curtail_flag: curtailmentEnabled && row.block >= curtailmentStart && row.block <= curtailmentEnd,
          }));
          setRawForecast(withCurtail);
          setGenTableEdits({});
        }
      } catch (e) {
        console.warn('Raw forecast fetch failed:', e);
      }
    };
    const handler = setTimeout(fetchRaw, 200);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, curtailmentEnabled, curtailmentStart, curtailmentEnd]);

  // ── Derived ──
  const blocks = scheduleData?.blocks || [];
  const summary = scheduleData?.summary;

  const value: OptimizerContextValue = {
    selectedDate, setSelectedDate,
    wtgCount, setWtgCount,
    solarAc, setSolarAc,
    rtcCommitment, setRtcCommitment,
    maxSocMwh, setMaxSocMwh,
    curtailmentEnabled, setCurtailmentEnabled,
    curtailmentStart, setCurtailmentStart,
    curtailmentEnd, setCurtailmentEnd,
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
