import React, { useState, useEffect, useRef, useCallback } from 'react';
import heroLogo from './assets/hero.png';
import {
  BatteryCharging,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Zap,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Download,
  Table2,
  Settings2
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarController,
  LineController
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarController,
  LineController
);

interface BlockData {
  block: number;
  time: string;
  wind_mw: number;
  solar_mw: number;
  generation_mw: number;
  psp_charge: number;
  psp_discharge: number;
  soc_start: number;
  soc_end: number;
  rtm_surplus: number;
  net_schedule: number;
  min_schedule: number;
  compliant: boolean;
  curtail_flag: boolean;
  carry_budget_mwh: number;
  carry_discharge_mw: number;
}

interface RawForecastRow {
  block: number;
  time: string;
  wind_speed: number;
  wind_speed_2024: number;
  wind_speed_2025: number;
  wind_mw_raw: number;
  solar_mw_raw: number;
  curtail_flag: boolean;
}

// ── Siemens Gamesa SG 3.15-114 Power Curve (kW per turbine) ──────────────
// Cut-in: 3.0 m/s  |  Rated: 11.0 m/s  |  Cut-out: 18.0 m/s
const POWER_CURVE_KW: Record<string, number> = {
  '3.0': 35, '3.1': 53.7, '3.2': 72.4, '3.3': 91.1, '3.4': 109.8, '3.5': 128.5, '3.6': 147.2, '3.7': 165.9, '3.8': 184.6, '3.9': 203.3,
  '4.0': 228, '4.1': 255.2, '4.2': 288.4, '4.3': 321.6, '4.4': 354.8, '4.5': 388, '4.6': 421.2, '4.7': 454.4, '4.8': 487.6, '4.9': 520.8,
  '5.0': 557, '5.1': 600.5, '5.2': 647, '5.3': 693.5, '5.4': 740, '5.5': 786.5, '5.6': 833, '5.7': 879.5, '5.8': 926, '5.9': 972.5,
  '6.0': 1025, '6.1': 1081.3, '6.2': 1143.6, '6.3': 1205.9, '6.4': 1268.2, '6.5': 1330.5, '6.6': 1392.8, '6.7': 1455.1, '6.8': 1517.4, '6.9': 1579.7,
  '7.0': 1642, '7.1': 1720.7, '7.2': 1799.4, '7.3': 1878.1, '7.4': 1956.8, '7.5': 2035.5, '7.6': 2114.2, '7.7': 2192.9, '7.8': 2271.6, '7.9': 2350.3,
  '8.0': 2429, '8.1': 2481.9, '8.2': 2534.8, '8.3': 2587.7, '8.4': 2640.6, '8.5': 2693.5, '8.6': 2746.4, '8.7': 2799.3, '8.8': 2852.2, '8.9': 2905.1,
  '9.0': 2935, '9.1': 2973.5, '9.2': 2989, '9.3': 3004.5, '9.4': 3025, '9.5': 3035.5, '9.6': 3051, '9.7': 3066.5, '9.8': 3082, '9.9': 3097.5,
  '10.0': 3113, '10.1': 3116.7, '10.2': 3120.4, '10.3': 3124.1, '10.4': 3127.8, '10.5': 3131.5, '10.6': 3135.2, '10.7': 3138.9, '10.8': 3142.6, '10.9': 3146.3,
  '11.0': 3150, '11.1': 3150, '11.2': 3150, '11.3': 3150, '11.4': 3150, '11.5': 3150, '11.6': 3150, '11.7': 3150, '11.8': 3150, '11.9': 3150,
  '12.0': 3150, '12.5': 3150, '13.0': 3150, '13.5': 3150, '14.0': 3150, '14.5': 3150, '15.0': 3150, '15.5': 3150, '16.0': 3150, '16.5': 3150,
  '17.0': 3150, '17.5': 3150, '17.9': 3150, '18.0': 0,
};

function lookupWindMW(windSpeed: number, wtgCount: number): number {
  const rounded = Math.round(windSpeed * 10) / 10;
  if (rounded < 3.0 || rounded > 18.0) return 0;
  // Find nearest 0.1 step in table
  const key = rounded.toFixed(1);
  const kw = POWER_CURVE_KW[key] ?? 0;
  return (kw / 1000) * wtgCount;
}

interface SummaryData {
  rtc_commitment_mw: number;
  min_schedule_mw: number;
  total_charged_mwh: number;
  total_discharged_mwh: number;
  cycles_used: number;
  min_soc_mwh: number;
  max_soc_mwh: number;
  end_soc_mwh: number;
  compliant_blocks: number;
  total_blocks: number;
  fully_compliant: boolean;
  total_rtm_surplus_mwh: number;
}

interface CarryForwardInfo {
  initial_soc_mwh: number;
  carry_budget_per_block: number[];
  carry_expires_per_block: number[];
  total_carry_available_mwh: number;
  total_carry_discharged_mwh: number;
  total_carry_expired_mwh: number;
  today_charge_schedule: number[];
}

interface ScheduleResponse {
  blocks: BlockData[];
  summary: SummaryData;
  carry_forward: CarryForwardInfo;
}

interface GenerationStats {
  min_mw: number;
  p5_mw: number;
  p10_mw: number;
  mean_mw: number;
  median_mw: number;
  p90_mw: number;
  p95_mw: number;
  max_mw: number;
}

interface RTCRangeData {
  non_curtailment_blocks: number;
  curtailment_blocks: number;
  curtailment_period_gen_lost_mwh: number;
  generation_stats: GenerationStats;
  psp_discharge_headroom_mw: number;
  min_rtc_mw: number;
  max_rtc_mw: number;
  recommended_rtc_mw: number;
  interpretation: {
    min_rtc_basis: string;
    max_rtc_basis: string;
    recommended_basis: string;
  };
}

// API base URL:
//   - In dev (npm run dev): Vite proxies /api → http://localhost:8000, so use relative ""
//   - In production: FastAPI serves the built frontend at the same origin, so use relative ""
//   - Override via VITE_API_URL env var for custom deployments (e.g. separate backend host)
const BASE_URL = import.meta.env.VITE_API_URL ?? "";

// Generate date options for June 2026
const JUNE_DATES = Array.from({ length: 30 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0');
  return `2026-06-${day}`;
});

export default function App() {
  // Config state
  const [selectedDate, setSelectedDate] = useState("2026-06-01");
  const [wtgCount, setWtgCount] = useState(15);
  const [solarAc, setSolarAc] = useState(60);
  const [rtcCommitment, setRtcCommitment] = useState(15.0);
  const [maxSocMwh, setMaxSocMwh] = useState(360.0); // configurable PSP capacity

  // Curtailment config
  const [curtailmentEnabled, setCurtailmentEnabled] = useState(true);
  const [curtailmentStart, setCurtailmentStart] = useState(37);
  const [curtailmentEnd, setCurtailmentEnd] = useState(64);

  // PSP loss %
  const [roundtripLoss, setRoundtripLoss] = useState(20.0);

  // Active sidebar tab: 'config' | 'data'
  const [sideTab, setSideTab] = useState<'config' | 'data'>('config');

  // Per-block editable overrides: { [block]: { wind_mw, solar_mw } }
  const [blockOverrides, setBlockOverrides] = useState<Record<number, { wind_mw: string, solar_mw: string }>>({});

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
  const [carryFromDate, setCarryFromDate] = useState<string | null>(null);  // which date the carry came from

  // Excel export state
  const [excelLoading, setExcelLoading] = useState(false);

  // SoC detail modal
  const [socModalOpen, setSocModalOpen] = useState(false);

  // Raw forecast data (wind_speed, solar_mw_raw per block)
  const [rawForecast, setRawForecast] = useState<RawForecastRow[]>([]);

  // Generation table edits: { [block]: { wind_speed?: string, solar_mw?: string } }
  type GenEdit = { wind_speed?: string; solar_mw?: string };
  const [genTableEdits, setGenTableEdits] = useState<Record<number, GenEdit>>({});
  const [genTableExpanded, setGenTableExpanded] = useState(true);

  // Table row reference for auto-scroll/highlighting
  const tableRef = useRef<HTMLDivElement>(null);
  const genTableRef = useRef<HTMLDivElement>(null);

  // Build block_overrides list for API — merges legacy blockOverrides + genTableEdits
  const buildOverridesList = useCallback(() => {
    // Start from genTableEdits (the new generation table)
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

    // Also merge legacy blockOverrides (sidebar edit data tab)
    const fromLegacy: Record<number, { wind_mw?: number; solar_mw?: number }> = {};
    Object.entries(blockOverrides).forEach(([blockStr, v]) => {
      const block = parseInt(blockStr);
      const entry: { wind_mw?: number; solar_mw?: number } = {};
      if (v.wind_mw !== '') entry.wind_mw = parseFloat(v.wind_mw);
      if (v.solar_mw !== '') entry.solar_mw = parseFloat(v.solar_mw);
      if (Object.keys(entry).length > 0) fromLegacy[block] = entry;
    });

    // genTableEdits takes priority over blockOverrides
    const merged: Record<number, { wind_mw?: number; solar_mw?: number }> = { ...fromLegacy, ...fromGenTable };
    return Object.entries(merged).map(([block, v]) => ({ block: parseInt(block), ...v }));
  }, [blockOverrides, genTableEdits, rawForecast, wtgCount]);


  const handleExcelDownload = async () => {
    setExcelLoading(true);
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        wtg_count: String(wtgCount),
        solar_ac_mw: String(solarAc),
        rtc_commitment_mw: String(rtcCommitment),
        curtailment_enabled: String(curtailmentEnabled),
        curtailment_start_block: String(curtailmentStart),
        curtailment_end_block: String(curtailmentEnd),
        roundtrip_loss_pct: String(roundtripLoss),
        min_compliance_ratio: '0.75',
        max_soc_mwh: String(maxSocMwh),
        min_dispatch_mw: '6',
        initial_soc_mwh: String(initialSocMwh),
      });
      const response = await fetch(`${BASE_URL}/api/export/excel?${params.toString()}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RTC_Dispatch_${selectedDate}_WTG${wtgCount}_Solar${solarAc}MW.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel download failed:', err);
      alert('Excel export failed. Please ensure the backend server is running.');
    } finally {
      setExcelLoading(false);
    }
  };

  // Fetch schedule on state change
  useEffect(() => {
    const fetchSchedule = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${BASE_URL}/api/schedule`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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

        if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`);
        }

        const data: ScheduleResponse = await response.json();
        setScheduleData(data);
      } catch (err: any) {
        console.error("Failed to fetch schedule data:", err);
        setError("Could not connect to the optimization backend. Please ensure the FastAPI server is running.");
      } finally {
        setLoading(false);
      }
    };

    // Debounce API calls slightly if sliders are dragged fast
    const handler = setTimeout(() => {
      fetchSchedule();
    }, 150);

    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, rtcCommitment, curtailmentEnabled, curtailmentStart, curtailmentEnd, roundtripLoss, maxSocMwh, initialSocMwh, prevDayChargeSchedule, buildOverridesList]);

  // One-click: carry SoC + charge schedule to next calendar day
  // Also auto-sets the RTC commitment to the optimal (fully-compliant) value for that day.
  const handleRollToNextDay = async () => {
    if (!scheduleData) return;
    const nextDate = JUNE_DATES[JUNE_DATES.indexOf(selectedDate) + 1];
    if (!nextDate) return;
    const endSoc = scheduleData.summary.end_soc_mwh;
    const todayCharges = scheduleData.carry_forward?.today_charge_schedule ?? null;

    // Fetch the optimal RTC for the next day using the carried-forward SOC
    // so we can set it atomically along with the date change.
    try {
      const rangeRes = await fetch(`${BASE_URL}/api/rtc-range`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: nextDate,
          wtg_count: wtgCount,
          solar_ac_mw: solarAc,
          curtailment_enabled: curtailmentEnabled,
          curtailment_start_block: curtailmentStart,
          curtailment_end_block: curtailmentEnd,
          roundtrip_loss_pct: roundtripLoss,
          min_compliance_ratio: 0.75,
          max_soc_mwh: maxSocMwh,
          min_dispatch_mw: 6,
          initial_soc_mwh: endSoc,
        }),
      });
      if (rangeRes.ok) {
        const rangeData: RTCRangeData = await rangeRes.json();
        setRtcRange(rangeData);
        // Auto-apply the optimal (fully-compliant) commitment for the new day
        setRtcCommitment(rangeData.recommended_rtc_mw);
      }
    } catch (e) {
      console.warn('Could not fetch optimal RTC for next day:', e);
    }

    setCarryFromDate(selectedDate);
    setInitialSocMwh(endSoc);
    setPrevDayChargeSchedule(todayCharges);
    setSelectedDate(nextDate); // triggers re-fetch with carry params
  };

  // Clear carry-forward (start fresh)
  const handleClearCarry = () => {
    setInitialSocMwh(0.0);
    setPrevDayChargeSchedule(null);
    setCarryFromDate(null);
  };

  // Fetch RTC Range whenever inputs that affect generation change (not rtcCommitment)
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

  // Fetch raw forecast (wind_speed, solar_mw_raw etc.) for the Generation Input Table
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
          // Apply curtailment flag from current settings (backend call doesn't take curtailment)
          // We merge the curtailment flag ourselves for display purposes
          const withCurtail = data.map(row => ({
            ...row,
            curtail_flag: curtailmentEnabled && row.block >= curtailmentStart && row.block <= curtailmentEnd,
          }));
          setRawForecast(withCurtail);
          setGenTableEdits({}); // reset user edits when base data changes
        }
      } catch (e) {
        console.warn('Raw forecast fetch failed:', e);
      }
    };
    const handler = setTimeout(fetchRaw, 200);
    return () => clearTimeout(handler);
  }, [selectedDate, wtgCount, solarAc, curtailmentEnabled, curtailmentStart, curtailmentEnd]);

  if (!scheduleData && loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', borderRadius: '50%', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#00d2ff', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ color: '#94a3b8', fontSize: '16px' }}>Solving dispatch optimization models...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const blocks = scheduleData?.blocks || [];
  const summary = scheduleData?.summary;

  // Chart configuration
  const labels = blocks.map(b => b.time.substring(0, 5));

  const chartData = {
    labels,
    datasets: [
      {
        type: 'bar' as const,
        label: 'Wind Generation (MW)',
        data: blocks.map(b => b.wind_mw),
        backgroundColor: 'rgba(0, 210, 255, 0.75)',
        borderColor: 'rgba(0, 210, 255, 0.9)',
        borderWidth: 1,
        stack: 'generation',
      },
      {
        type: 'bar' as const,
        label: 'Solar Generation (MW)',
        data: blocks.map(b => b.solar_mw),
        backgroundColor: 'rgba(245, 158, 11, 0.75)',
        borderColor: 'rgba(245, 158, 11, 0.9)',
        borderWidth: 1,
        stack: 'generation',
      },
      {
        type: 'bar' as const,
        label: 'PSP Discharge (MW)',
        data: blocks.map(b => b.psp_discharge),
        backgroundColor: 'rgba(139, 92, 246, 0.75)',
        borderColor: 'rgba(139, 92, 246, 0.9)',
        borderWidth: 1,
        stack: 'generation',
      },
      {
        type: 'bar' as const,
        label: 'PSP Charge (MW)',
        data: blocks.map(b => -b.psp_charge), // Negative to display downwards
        backgroundColor: 'rgba(236, 72, 153, 0.65)',
        borderColor: 'rgba(236, 72, 153, 0.8)',
        borderWidth: 1,
        stack: 'charge',
      },
      {
        type: 'bar' as const,
        label: 'RTM Market Surplus (MW)',
        data: blocks.map(b => b.rtm_surplus),
        backgroundColor: 'rgba(107, 114, 128, 0.55)',
        borderColor: 'rgba(107, 114, 128, 0.7)',
        borderWidth: 1,
        stack: 'surplus',
      },
      {
        type: 'line' as const,
        label: 'Net Grid Injected Schedule (MW)',
        data: blocks.map(b => b.net_schedule),
        borderColor: '#10b981',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
      },
      {
        type: 'line' as const,
        label: 'RTC Commitment Target (MW)',
        data: blocks.map(() => rtcCommitment),
        borderColor: 'rgba(239, 68, 68, 0.75)',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
      },
      {
        type: 'line' as const,
        label: 'Min 75% Compliance Floor (MW)',
        data: blocks.map(() => rtcCommitment * 0.75),
        borderColor: 'rgba(239, 68, 68, 0.45)',
        borderWidth: 1.5,
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
      }
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // Customized legends rendered in react component
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(13, 20, 38, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        titleFont: {
          family: 'Outfit',
          size: 14,
          weight: 'bold' as const
        },
        bodyFont: {
          family: 'Outfit',
          size: 12
        },
        callbacks: {
          label: function (context: any) {
            let label = context.dataset.label || '';
            let val = context.raw;
            if (val < 0) val = -val; // absolute value for negative charge bars
            return `  ${label}: ${val.toFixed(2)} MW`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(255, 255, 255, 0.03)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            family: 'Outfit',
            size: 10
          },
          maxTicksLimit: 24
        }
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.04)',
        },
        ticks: {
          color: '#94a3b8',
          font: {
            family: 'Outfit',
            size: 11
          }
        },
        title: {
          display: true,
          text: 'Power Rate (MW)',
          color: '#94a3b8',
          font: {
            family: 'Outfit',
            size: 12,
            weight: 'bold' as const
          }
        }
      }
    }
  };

  // State of charge percentage for tank gauge — now uses configurable maxSocMwh
  const endSocMwh = summary?.end_soc_mwh || 0.0;
  const socPercentage = Math.min(((endSocMwh / maxSocMwh) * 100), 100).toFixed(1);

  // SoC line chart data for the modal
  const socChartData = {
    labels: blocks.map(b => b.time.substring(0, 5)),
    datasets: [
      {
        type: 'line' as const,
        label: 'State of Charge (MWh)',
        data: blocks.map(b => b.soc_end),
        borderColor: '#8b5cf6',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        backgroundColor: 'rgba(139, 92, 246, 0.12)',
        tension: 0.3,
      },
      {
        type: 'line' as const,
        label: `Max Capacity (${maxSocMwh} MWh)`,
        data: blocks.map(() => maxSocMwh),
        borderColor: 'rgba(100, 116, 139, 0.5)',
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const socChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(13, 20, 38, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(139,92,246,0.3)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (ctx: any) => `  ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)} MWh`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 }, maxTicksLimit: 24 },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        min: 0,
        max: maxSocMwh * 1.05,
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
        title: { display: true, text: 'SoC (MWh)', color: '#94a3b8', font: { family: 'Outfit', size: 12, weight: 'bold' as const } },
      },
    },
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%', padding: '28px 24px 20px' }}>

      {/* Top Banner Header — 3-col: logo | title (centered) | badge */}
      <header className="dashboard-header">

        {/* LEFT — Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '0 0 auto' }}>
          <img
            src="/logo.png"
            alt="Manikaran Analytics Logo"
            style={{
              height: '56px',
              width: 'auto',
              objectFit: 'contain',
              // filter: 'drop-shadow(0 0 10px rgba(139,92,246,0.45))',
            }}
          />

        </div>

        {/* CENTER — Title (truly centered via flex:1 + text-align:center) */}
        <div className="header-title-area" style={{ flex: 1, textAlign: 'center' }}>
          <h1>RE-RTC DISPATCH OPTIMIZER</h1>
          {/* <p>Aditya Birla Renewables &bull; Hindalco Mahan 100 MW Round-The-Clock Captive PPA</p> */}
        </div>

        {/* RIGHT — Status badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto', justifyContent: 'flex-end' }}>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171', fontSize: '13px' }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {summary && (
            <div className={`badge-compliance ${summary.fully_compliant ? 'compliant' : 'shortfall'}`}>
              {summary.fully_compliant ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{summary.fully_compliant ? 'FULLY COMPLIANT' : 'SHORTFALL WARNING'}</span>
            </div>
          )}
        </div>
      </header>

      {/* KPI Cards Panel + Roll to Next Day bar */}
      {summary && (
        <>
          <section className="kpi-grid">
            <div className="glass-panel kpi-card" style={{ '--accent-color': 'var(--color-wind)' } as React.CSSProperties}>
              <div className="kpi-header">
                <span>RTC Commitment Target</span>
                <Zap size={16} style={{ color: 'var(--color-wind)' }} />
              </div>
              <div className="kpi-value">
                <span>{summary.rtc_commitment_mw.toFixed(1)}</span>
                <span className="kpi-unit">MW</span>
              </div>
              <span className="kpi-subtitle">Compliance threshold: {(summary.rtc_commitment_mw * 0.75).toFixed(1)} MW (75%)</span>
            </div>

            <div className="glass-panel kpi-card" style={{ '--accent-color': 'var(--color-target)' } as React.CSSProperties}>
              <div className="kpi-header">
                <span>Compliant Intervals</span>
                <CheckCircle2 size={16} style={{ color: 'var(--color-target)' }} />
              </div>
              <div className="kpi-value">
                <span>{summary.compliant_blocks}</span>
                <span className="kpi-unit">/ 96</span>
              </div>
              <span className="kpi-subtitle">
                {summary.fully_compliant ? '100% daily availability met' : `${96 - summary.compliant_blocks} blocks with shortfalls`}
              </span>
            </div>

            <div className="glass-panel kpi-card" style={{ '--accent-color': 'var(--color-psp-discharge)' } as React.CSSProperties}>
              <div className="kpi-header">
                <span>PSP Cycles Dispatched</span>
                <BatteryCharging size={16} style={{ color: 'var(--color-psp-discharge)' }} />
              </div>
              <div className="kpi-value">
                <span>{summary.cycles_used.toFixed(2)}</span>
                <span className="kpi-unit">/ 2.0</span>
              </div>
              <span className="kpi-subtitle">Charged: {summary.total_charged_mwh.toFixed(1)} MWh (usable: {((summary as any).psp_usable_charged_mwh ?? summary.total_charged_mwh * 0.8).toFixed(1)} MWh) | EOD SoC: {summary.end_soc_mwh.toFixed(1)} MWh</span>
            </div>

            <div className="glass-panel kpi-card" style={{ '--accent-color': 'var(--color-rtm)' } as React.CSSProperties}>
              <div className="kpi-header">
                <span>RTM Market Surplus</span>
                <TrendingUp size={16} style={{ color: 'var(--color-rtm)' }} />
              </div>
              <div className="kpi-value" style={{ color: '#e2e8f0' }}>
                <span>{summary.total_rtm_surplus_mwh.toFixed(1)}</span>
                <span className="kpi-unit">MWh</span>
              </div>
              <span className="kpi-subtitle">Exportable generation above 100% PPA commitment</span>
            </div>
          </section>


          {/* ── Roll to Next Day Action Bar ─────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
            padding: '12px 16px',
            background: carryFromDate ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${carryFromDate ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '10px',
            marginBottom: '4px',
          }}>
            {/* Status pill */}
            {carryFromDate ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#34d399' }}>Carry-Forward ACTIVE</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Started from {carryFromDate} — Starting SoC: <strong style={{ color: '#34d399' }}>{initialSocMwh.toFixed(1)} MWh</strong></div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <span style={{ fontSize: '15px' }}>📅</span>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  End-of-day SoC: <strong style={{ color: '#e2e8f0' }}>{summary.end_soc_mwh.toFixed(1)} MWh</strong>
                  &nbsp;·&nbsp; Available carry energy (after losses): <strong style={{ color: '#e2e8f0' }}>
                    {((scheduleData?.carry_forward?.today_charge_schedule ?? []).reduce((a, c) => a + c, 0) * 0.25 * (1 - roundtripLoss / 100)).toFixed(1)} MWh
                  </strong>
                </div>
              </div>
            )}
            {/* Next Day button */}
            {JUNE_DATES.indexOf(selectedDate) < JUNE_DATES.length - 1 && (
              <button
                onClick={handleRollToNextDay}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: 'none', borderRadius: '8px', color: '#fff',
                  fontSize: '13px', fontWeight: '700', padding: '8px 18px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  boxShadow: '0 2px 8px rgba(16,185,129,0.4)',
                  transition: 'transform 0.1s ease',
                }}
                onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
                onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                Roll to {JUNE_DATES[JUNE_DATES.indexOf(selectedDate) + 1]?.replace('2026-06-', 'Jun ')} →
              </button>
            )}
            {/* Clear button when carry active */}
            {carryFromDate && (
              <button
                onClick={handleClearCarry}
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '12px', padding: '7px 14px', cursor: 'pointer', fontWeight: '600' }}
              >
                ✕ Start Fresh
              </button>
            )}
          </div>
        </>)}

      {/* Main Layout Grid */}
      <main className="main-layout">

        {/* Left Control Panel Column */}
        <aside className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={18} style={{ color: '#a5b4fc' }} />
            <span>Operational Config</span>
          </h2>

          {/* Date Selector */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Simulation Date</span>
            </div>
            <select
              className="date-select"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {JUNE_DATES.map(date => (
                <option key={date} value={date}>
                  {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>

          {/* WTG Sliders */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Wind Turbines (WTGs)</span>
              <span className="config-value" style={{ color: 'var(--color-wind)' }}>{wtgCount} Units</span>
            </div>
            <input
              type="range"
              min="1"
              max="59"
              className="range-slider"
              value={wtgCount}
              onChange={(e) => setWtgCount(parseInt(e.target.value))}
              style={{ '--color-wind': 'var(--color-wind)' } as React.CSSProperties}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>1 WTG (3.15 MW)</span>
              <span>Total Capacity: {(wtgCount * 3.15).toFixed(1)} MW</span>
            </div>
          </div>

          {/* Solar AC Sliders */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Solar Net Capacity</span>
              <span className="config-value" style={{ color: 'var(--color-solar)' }}>{solarAc} MW AC</span>
            </div>
            <input
              type="range"
              min="5"
              max="175"
              className="range-slider"
              value={solarAc}
              onChange={(e) => setSolarAc(parseInt(e.target.value))}
              style={{ '--color-wind': 'var(--color-solar)' } as React.CSSProperties}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>5 MW AC</span>
              <span>Max: 175 MW AC (PPA base)</span>
            </div>
          </div>

          {/* RTC Commitment Sliders */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">RTC Commitment</span>
              <span className="config-value" style={{ color: 'var(--color-target)' }}>{rtcCommitment.toFixed(1)} MW</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="100.0"
              step="0.5"
              className="range-slider"
              value={rtcCommitment}
              onChange={(e) => setRtcCommitment(parseFloat(e.target.value))}
              style={{ '--color-wind': 'var(--color-target)' } as React.CSSProperties}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>1.0 MW</span>
              <span>Max PPA Limit: 100.0 MW</span>
            </div>
          </div>

          {/* ── RTC Suggestion Card ─────────────────────────────── */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(16,185,129,0.08) 100%)',
            border: '1px solid rgba(99,102,241,0.28)',
            borderRadius: '12px',
            padding: '14px 16px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Glowing accent */}
            <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '80px', height: '80px', background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <button
              onClick={() => setRangeExpanded(p => !p)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: '700', fontSize: '13px', color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                <Lightbulb size={14} style={{ color: '#fbbf24' }} />
                Manikaran's Suggestion
              </span>
              {rangeExpanded ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
            </button>

            {rangeExpanded && (
              <div style={{ marginTop: '12px' }}>
                {rangeLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '12px' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid rgba(99,102,241,0.2)', borderTopColor: '#818cf8', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    Analysing generation capacity...
                  </div>
                )}

                {!rangeLoading && rtcRange && (
                  <>
                    {/* Three pill suggestions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                      {/* Min */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: '8px', padding: '8px 12px' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Min Safe Commit</div>
                          <div style={{ fontSize: '20px', fontWeight: '800', color: '#f87171', fontFamily: 'monospace' }}>{rtcRange.min_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>75% of P10 non-curtail gen</div>
                        </div>
                        <button
                          onClick={() => setRtcCommitment(rtcRange.min_rtc_mw)}
                          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}
                        >Use Min</button>
                      </div>

                      {/* Recommended */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '8px 12px', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: '-8px', right: '10px', background: 'linear-gradient(90deg,#10b981,#059669)', borderRadius: '4px', fontSize: '9px', padding: '2px 6px', color: '#fff', fontWeight: '700', letterSpacing: '0.5px' }}>RECOMMENDED</div>
                        <div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Optimal Commit</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#34d399', fontFamily: 'monospace' }}>{rtcRange.recommended_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Max RTC → 0 shortfall blocks (dispatch-validated)</div>
                        </div>
                        <button
                          onClick={() => setRtcCommitment(rtcRange.recommended_rtc_mw)}
                          style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '6px', color: '#34d399', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}
                        >✓ Use This</button>
                      </div>

                      {/* Max */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.20)', borderRadius: '8px', padding: '8px 12px' }}>
                        <div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Max Aggressive</div>
                          <div style={{ fontSize: '20px', fontWeight: '800', color: '#818cf8', fontFamily: 'monospace' }}>{rtcRange.max_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>P90 non-curtail gen (PSP backup)</div>
                        </div>
                        <button
                          onClick={() => setRtcCommitment(rtcRange.max_rtc_mw)}
                          style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', color: '#818cf8', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}
                        >Use Max</button>
                      </div>
                    </div>

                    {/* Stat strip */}
                    <div style={{ marginTop: '10px', padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '11px' }}>
                      <div style={{ color: '#64748b' }}>Non-curtail blocks: <span style={{ color: '#cbd5e1' }}>{rtcRange.non_curtailment_blocks}</span></div>
                      <div style={{ color: '#64748b' }}>Curtail lost: <span style={{ color: '#fbbf24' }}>{rtcRange.curtailment_period_gen_lost_mwh.toFixed(1)} MWh</span></div>
                      <div style={{ color: '#64748b' }}>Gen P10: <span style={{ color: '#cbd5e1' }}>{rtcRange.generation_stats.p10_mw.toFixed(1)} MW</span></div>
                      <div style={{ color: '#64748b' }}>Gen P90: <span style={{ color: '#cbd5e1' }}>{rtcRange.generation_stats.p90_mw.toFixed(1)} MW</span></div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Curtailment Config */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '10px', padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Curtailment Window</span>
              <button onClick={() => setCurtailmentEnabled(p => !p)} style={{ background: curtailmentEnabled ? 'rgba(251,191,36,0.2)' : 'rgba(100,116,139,0.15)', border: `1px solid ${curtailmentEnabled ? 'rgba(251,191,36,0.5)' : 'rgba(100,116,139,0.3)'}`, borderRadius: '20px', color: curtailmentEnabled ? '#fbbf24' : '#64748b', fontSize: '11px', padding: '3px 10px', cursor: 'pointer', fontWeight: '700' }}>
                {curtailmentEnabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>
            {curtailmentEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>From Block</div>
                  <input type="number" min={1} max={96} value={curtailmentStart} onChange={e => setCurtailmentStart(parseInt(e.target.value))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', color: '#fbbf24', padding: '6px 8px', fontSize: '13px', fontWeight: '700', textAlign: 'center' }} />
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', textAlign: 'center' }}>≈ {((curtailmentStart - 1) * 15 / 60).toFixed(1).replace('.0', ':00').replace('.5', ':30')}h IST</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>To Block</div>
                  <input type="number" min={1} max={96} value={curtailmentEnd} onChange={e => setCurtailmentEnd(parseInt(e.target.value))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', color: '#fbbf24', padding: '6px 8px', fontSize: '13px', fontWeight: '700', textAlign: 'center' }} />
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', textAlign: 'center' }}>≈ {Math.floor(curtailmentEnd * 15 / 60).toString().padStart(2, '0')}:{((curtailmentEnd * 15 % 60) === 0 ? '00' : '30')}h IST</div>
                </div>
              </div>
            )}
            {!curtailmentEnabled && <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'center' }}>No curtailment — full generation all 96 blocks</div>}
          </div>

          {/* PSP Round-Trip Loss */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">PSP Round-Trip Loss</span>
              <span className="config-value" style={{ color: '#f87171' }}>{roundtripLoss.toFixed(0)}%</span>
            </div>
            <input type="range" min="10" max="30" step="1" className="range-slider" value={roundtripLoss} onChange={e => setRoundtripLoss(parseFloat(e.target.value))} style={{ '--color-wind': '#f87171' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>10% (optimistic)</span>
              <span>Usable per MWh stored: {(100 - roundtripLoss).toFixed(0)}%</span>
            </div>
          </div>

          {/* PSP Max Capacity (configurable, capped at 360 MWh) */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">PSP Max Capacity</span>
              <span className="config-value" style={{ color: '#a78bfa' }}>{maxSocMwh.toFixed(0)} MWh</span>
            </div>
            <input
              type="range"
              min="10"
              max="360"
              step="5"
              className="range-slider"
              value={maxSocMwh}
              onChange={e => setMaxSocMwh(parseFloat(e.target.value))}
              style={{ '--color-wind': '#a78bfa' } as React.CSSProperties}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>10 MWh (min)</span>
              <span style={{ color: maxSocMwh === 360 ? '#64748b' : '#f59e0b' }}>
                {maxSocMwh < 360 ? `${(360 - maxSocMwh).toFixed(0)} MWh below ceiling` : 'Full 360 MWh (CERC cap)'}
              </span>
            </div>
          </div>

          {/* Editable Data Tab toggle hint */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setSideTab('config')} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid ${sideTab === 'config' ? 'rgba(165,180,252,0.5)' : 'rgba(100,116,139,0.2)'}`, background: sideTab === 'config' ? 'rgba(165,180,252,0.12)' : 'transparent', color: sideTab === 'config' ? '#a5b4fc' : '#64748b', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              <Settings2 size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Config
            </button>
            <button onClick={() => setSideTab('data')} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid ${sideTab === 'data' ? 'rgba(251,191,36,0.5)' : 'rgba(100,116,139,0.2)'}`, background: sideTab === 'data' ? 'rgba(251,191,36,0.1)' : 'transparent', color: sideTab === 'data' ? '#fbbf24' : '#64748b', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              <Table2 size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Edit Data
            </button>
          </div>
          {sideTab === 'data' && (
            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px' }}>
              <div style={{ padding: '8px 10px', background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.15)', fontSize: '11px', color: '#fbbf24', fontWeight: '700' }}>
                Override Wind/Solar per Block — leave blank to use forecast
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead><tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                  <th style={{ padding: '4px 6px', color: '#94a3b8', textAlign: 'center' }}>Block</th>
                  <th style={{ padding: '4px 6px', color: '#00b4d8', textAlign: 'center' }}>Wind MW</th>
                  <th style={{ padding: '4px 6px', color: '#f59e0b', textAlign: 'center' }}>Solar MW</th>
                </tr></thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.block} style={{ background: b.curtail_flag ? 'rgba(51,65,85,0.3)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '3px 6px', color: '#64748b', textAlign: 'center', fontWeight: '700' }}>{b.block}<span style={{ fontSize: '9px', marginLeft: 2 }}>{b.time.substring(0, 5)}</span></td>
                      <td style={{ padding: '2px 4px' }}>
                        <input type="number" placeholder={b.wind_mw.toFixed(2)} value={blockOverrides[b.block]?.wind_mw ?? ''} onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, wind_mw: e.target.value } }))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(0,180,216,0.2)', borderRadius: '4px', color: '#00d2ff', padding: '3px 5px', fontSize: '11px' }} />
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        <input type="number" placeholder={b.solar_mw.toFixed(2)} value={blockOverrides[b.block]?.solar_mw ?? ''} onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, solar_mw: e.target.value } }))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '4px', color: '#f59e0b', padding: '3px 5px', fontSize: '11px' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(blockOverrides).length > 0 && (
                <div style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button onClick={() => setBlockOverrides({})} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', padding: '4px 10px', cursor: 'pointer' }}>Clear All Overrides</button>
                </div>
              )}
            </div>
          )}

          {/* SoC Carry-Forward info panel */}
          <div style={{
            background: carryFromDate ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${carryFromDate ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '10px',
            padding: '12px'
          }}>
            <div style={{ fontWeight: '700', color: carryFromDate ? '#34d399' : '#64748b', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>⚡ SoC Carry-Forward</div>
            {carryFromDate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Carrying from <span style={{ color: '#34d399' }}>{carryFromDate}</span></div>
                <div style={{ fontSize: '12px', color: '#e2e8f0' }}>Starting SoC: <span style={{ color: '#34d399', fontWeight: '700' }}>{initialSocMwh.toFixed(1)} MWh</span></div>
                <button onClick={handleClearCarry} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600' }}>✕ Clear — Start Fresh</button>
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: '#64748b' }}>Each day starts fresh at SoC = 0 MWh.<br />Use <strong style={{ color: '#94a3b8' }}>Roll to Next Day →</strong> in results to carry SoC.</div>
            )}
          </div>

          {/* Guidelines */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-color)', borderRadius: '8px', padding: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '4px', fontSize: '13px' }}>Regulatory Constraints:</span>
            <ul style={{ paddingLeft: '16px', margin: 0 }}>
              <li style={{ marginBottom: '4px' }}>Curtailment: {curtailmentEnabled ? `Blocks ${curtailmentStart}–${curtailmentEnd}` : 'Disabled this season'}.</li>
              <li style={{ marginBottom: '4px' }}>Orvakallu PSP storage capacity capped at 360 MWh.</li>
              <li>Min delivery floor: 75% of RTC commitment.</li>
            </ul>
          </div>
        </aside>

        {/* Right Output Panels Columns */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Chart + Tank Gauge Grid */}
          <div className="visuals-container">

            {/* Stacked Chart Panel */}
            <section className="glass-panel chart-panel">
              <div className="chart-header">
                <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0' }}>Dispatch Schedule Matrix (96 Blocks)</h2>

                {/* Custom Legends */}
                <div className="legend-group">
                  <div className="legend-item">
                    <div className="legend-color" style={{ background: 'var(--color-wind)' }}></div>
                    <span>Wind</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ background: 'var(--color-solar)' }}></div>
                    <span>Solar</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ background: 'var(--color-psp-discharge)' }}></div>
                    <span>PSP Discharge</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ background: 'var(--color-psp-charge)' }}></div>
                    <span>PSP Charge</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-color" style={{ background: 'var(--color-rtm)' }}></div>
                    <span>RTM Surplus</span>
                  </div>
                  <div className="legend-item">
                    <div style={{ width: '12px', height: '3px', background: '#10b981' }}></div>
                    <span>Net Deliverable</span>
                  </div>
                  <div className="legend-item">
                    <div style={{ width: '12px', height: '1.5px', borderBottom: '2px dashed rgba(239, 68, 68, 0.75)' }}></div>
                    <span>Commitment Target</span>
                  </div>
                </div>
              </div>

              {/* Chart Canvas Wrap */}
              <div style={{ flex: 1, minHeight: '300px', position: 'relative' }}>
                {loading && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(7, 10, 19, 0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 5, borderRadius: '8px' }}>
                    <div className="spinner" style={{ width: '28px', height: '28px', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#00d2ff', animation: 'spin 1s linear infinite' }}></div>
                  </div>
                )}
                <Chart type="bar" data={chartData as any} options={chartOptions as any} />
              </div>
            </section>

            {/* PSP State of Charge Tank Panel */}
            <section
              className="glass-panel psp-tank-panel"
              onClick={() => blocks.length > 0 && setSocModalOpen(true)}
              style={{ cursor: blocks.length > 0 ? 'pointer' : 'default', position: 'relative' }}
              title="Click to view full SoC timeline"
            >
              <h2 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 8px 0', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                PSP State Of Charge
              </h2>
              {blocks.length > 0 && (
                <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'center', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '12px' }}>📊</span> Click to view SoC timeline
                </div>
              )}

              <div className="tank-container">
                <div className="tank-glass-highlight"></div>
                <div className="tank-label">
                  {socPercentage}%
                  <span className="tank-label-sub">{endSocMwh.toFixed(1)} / {maxSocMwh} MWh</span>
                </div>
                <div className="tank-liquid" style={{ '--fill-percent': `${socPercentage}%` } as React.CSSProperties}></div>
              </div>

              <div className="psp-metrics">
                <div className="psp-metric-row">
                  <span>Substation Location</span>
                  <span>Orvakallu AP</span>
                </div>
                <div className="psp-metric-row">
                  <span>Configured Capacity</span>
                  <span style={{ color: maxSocMwh < 360 ? '#f59e0b' : 'var(--text-primary)' }}>{maxSocMwh} MWh</span>
                </div>
                <div className="psp-metric-row">
                  <span>Max Drawal (Charge)</span>
                  <span>60 MW</span>
                </div>
                <div className="psp-metric-row">
                  <span>Max Injection (Disch.)</span>
                  <span>50 MW</span>
                </div>
                <div className="psp-metric-row">
                  <span>Min Dispatch</span>
                  <span style={{ color: '#fbbf24' }}>6 MW (CERC)</span>
                </div>
                <div className="psp-metric-row">
                  <span>Avg Roundtrip Loss</span>
                  <span>{roundtripLoss.toFixed(0)}% ({(1 / (1 - roundtripLoss / 100)).toFixed(2)}x)</span>
                </div>
              </div>
            </section>

          </div>

          {/* ── SoC Timeline Modal ─────────────────────────────────────────────── */}
          {socModalOpen && blocks.length > 0 && (
            <div
              onClick={() => setSocModalOpen(false)}
              style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.75)',
                backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '24px',
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'rgba(13, 20, 38, 0.97)',
                  border: '1px solid rgba(139, 92, 246, 0.35)',
                  borderRadius: '16px',
                  padding: '28px',
                  width: '100%',
                  maxWidth: '820px',
                  boxShadow: '0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(139,92,246,0.15)',
                }}
              >
                {/* Modal Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '20px' }}>🔋</span>
                      PSP State of Charge — {selectedDate}
                    </h3>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                      96-block intraday SoC profile · Max capacity: {maxSocMwh} MWh · Min dispatch: 6 MW (CERC)
                    </p>
                  </div>
                  <button
                    onClick={() => setSocModalOpen(false)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#94a3b8', fontSize: '18px', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  >✕</button>
                </div>

                {/* SoC Stats Strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' }}>
                  {[
                    { label: 'Start SoC', value: `${blocks[0]?.soc_start?.toFixed(1)} MWh`, color: '#94a3b8' },
                    { label: 'Peak SoC', value: `${Math.max(...blocks.map(b => b.soc_end)).toFixed(1)} MWh`, color: '#34d399' },
                    { label: 'Min SoC', value: `${Math.min(...blocks.map(b => b.soc_end)).toFixed(1)} MWh`, color: '#f87171' },
                    { label: 'End-of-Day SoC', value: `${blocks[blocks.length - 1]?.soc_end?.toFixed(1)} MWh`, color: '#a78bfa' },
                  ].map(stat => (
                    <div key={stat.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{stat.label}</div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: stat.color, fontFamily: 'JetBrains Mono, monospace' }}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ height: '300px', position: 'relative' }}>
                  <Chart type="line" data={socChartData as any} options={socChartOptions as any} />
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: '20px', marginTop: '12px', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
                    <div style={{ width: '20px', height: '3px', background: '#8b5cf6', borderRadius: '2px' }}></div>
                    <span>SoC (MWh)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
                    <div style={{ width: '20px', height: '2px', borderBottom: '2px dashed rgba(100,116,139,0.7)' }}></div>
                    <span>Max Capacity ({maxSocMwh} MWh)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Scrollable Data Table Panel */}
          <section className="glass-panel table-panel">
            <div className="table-header-wrapper">
              <h2 className="table-title">Interval-Wise Energy Accounts (15-min)</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', flexWrap: 'wrap' }}>
                <span className="cell-badge curtail">Wind + Solar Curtailment Active (B37–64)</span>
                <span className="cell-badge warn" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#ef4444' }}>Compliance Shortfall</span>
                <button
                  id="btn-download-excel"
                  onClick={handleExcelDownload}
                  disabled={excelLoading || !scheduleData}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    background: excelLoading
                      ? 'rgba(16,185,129,0.05)'
                      : 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(5,150,105,0.12) 100%)',
                    border: '1px solid rgba(16,185,129,0.35)',
                    borderRadius: '8px',
                    color: '#34d399',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: excelLoading || !scheduleData ? 'not-allowed' : 'pointer',
                    opacity: excelLoading || !scheduleData ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                    letterSpacing: '0.3px',
                    whiteSpace: 'nowrap',
                    fontFamily: 'Outfit, sans-serif'
                  }}
                  onMouseEnter={e => {
                    if (!excelLoading && scheduleData) {
                      (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(16,185,129,0.28) 0%, rgba(5,150,105,0.22) 100%)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,0.6)';
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(16,185,129,0.25)';
                    }
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(5,150,105,0.12) 100%)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,0.35)';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                  }}
                >
                  {excelLoading ? (
                    <>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid rgba(52,211,153,0.2)', borderTopColor: '#34d399', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download size={13} />
                      Download Excel
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="table-container" ref={tableRef}>
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>TB</th>
                    <th>Time</th>
                    <th>Wind MW</th>
                    <th>Solar MW</th>
                    <th>Combined Generation</th>
                    <th>PSP Action</th>
                    <th>SoC end</th>
                    <th>Net Schedule</th>
                    <th>Target Floor</th>
                    <th style={{ color: 'var(--color-rtm)' }}>RTM MW</th>
                    <th style={{ color: '#34d399', fontSize: '11px' }}>Carry Budget</th>
                    <th style={{ color: '#34d399', fontSize: '11px' }}>Carry Disch.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b) => {
                    let pspBadge = <span className="psp-action-badge idle">Idle</span>;
                    if (b.psp_charge > 0) {
                      pspBadge = <span className="psp-action-badge charge">▲ Charge: {b.psp_charge.toFixed(1)}</span>;
                    } else if (b.psp_discharge > 0) {
                      pspBadge = <span className="psp-action-badge discharge">▼ Disch: {b.psp_discharge.toFixed(1)}</span>;
                    }

                    const isCurtailed = b.curtail_flag;
                    const isShortfall = !b.compliant;

                    let rowClass = "";
                    if (isShortfall) rowClass = "shortfall-row";
                    else if (isCurtailed) rowClass = "curtailed-row";

                    return (
                      <tr key={b.block} className={rowClass}>
                        <td className="mono-col">{b.block}</td>
                        <td className="mono-col">{b.time.substring(0, 5)}</td>
                        <td className="mono-col">
                          {isCurtailed ? (
                            <span style={{ color: 'var(--color-wind)', fontWeight: '600' }}>0.00 ✂</span>
                          ) : (
                            b.wind_mw.toFixed(2)
                          )}
                        </td>
                        <td className="mono-col">
                          {isCurtailed ? (
                            <span style={{ color: 'var(--color-solar)', fontWeight: '600' }}>0.00 ✂</span>
                          ) : (
                            b.solar_mw.toFixed(2)
                          )}
                        </td>
                        <td className="mono-col">{(b.wind_mw + b.solar_mw).toFixed(2)}</td>
                        <td>{pspBadge}</td>
                        <td className="mono-col">{b.soc_end.toFixed(1)} MWh</td>
                        <td className="mono-col" style={{ color: isShortfall ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                          {Math.min(b.net_schedule, rtcCommitment).toFixed(2)}
                        </td>
                        <td className="mono-col">{b.min_schedule.toFixed(2)}</td>
                        <td className="mono-col" style={{ color: b.rtm_surplus > 0 ? 'var(--color-rtm)' : 'var(--text-muted)' }}>
                          {b.rtm_surplus.toFixed(2)}
                        </td>
                        <td className="mono-col" style={{ color: b.carry_budget_mwh > 0 ? '#34d399' : 'var(--text-muted)', fontSize: '12px' }}>
                          {b.carry_budget_mwh > 0 ? b.carry_budget_mwh.toFixed(2) : '—'}
                        </td>
                        <td className="mono-col" style={{ color: b.carry_discharge_mw > 0 ? '#6ee7b7' : 'var(--text-muted)', fontSize: '12px' }}>
                          {b.carry_discharge_mw > 0 ? b.carry_discharge_mw.toFixed(2) : '—'}
                        </td>
                        <td>
                          <span className={`cell-badge ${isShortfall ? 'warn' : 'ok'}`}>
                            {isShortfall ? 'Shortfall' : 'Compliant'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Generation Input Data Table ─────────────────────────────── */}
          {rawForecast.length > 0 && (
            <section className="glass-panel" style={{ marginTop: '0' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: genTableExpanded ? '16px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    🌬️ Generation Input Data (Wind &amp; Solar)
                  </h2>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(0,210,255,0.1)', border: '1px solid rgba(0,210,255,0.25)', color: '#00d2ff', fontWeight: '600' }}>
                    EDITABLE · 96 BLOCKS
                  </span>
                  {Object.keys(genTableEdits).length > 0 && (
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontWeight: '700' }}>
                      {Object.keys(genTableEdits).length} BLOCK{Object.keys(genTableEdits).length !== 1 ? 'S' : ''} MODIFIED
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {Object.keys(genTableEdits).length > 0 && (
                    <button
                      onClick={() => setGenTableEdits({})}
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '7px', color: '#f87171', fontSize: '12px', padding: '5px 12px', cursor: 'pointer', fontWeight: '600' }}
                    >
                      ↺ Reset All
                    </button>
                  )}
                  <button
                    onClick={() => setGenTableExpanded(p => !p)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: '#94a3b8', fontSize: '12px', padding: '5px 12px', cursor: 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {genTableExpanded ? '▲ Collapse' : '▼ Expand'}
                  </button>
                </div>
              </div>

              {genTableExpanded && (
                <>
                  {/* Help strip */}
                  <div style={{ marginBottom: '12px', padding: '8px 12px', background: 'rgba(0,210,255,0.05)', border: '1px solid rgba(0,210,255,0.12)', borderRadius: '8px', fontSize: '11px', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                    <span>💡 <strong style={{ color: '#94a3b8' }}>Click any cell</strong> to edit. Wind Gen MW updates automatically from the power curve when you change Wind Speed.</span>
                    <span>📋 <strong style={{ color: '#94a3b8' }}>Paste from Excel</strong> — click a row then Ctrl+V to paste tab-separated data (Wind Speed, Solar MW columns).</span>
                    <span>🟡 <strong style={{ color: '#f59e0b' }}>Amber rows</strong> have been modified and will override the forecast in the optimizer.</span>
                  </div>

                  <div className="table-container gen-input-table" ref={genTableRef} style={{ maxHeight: '440px' }}>
                    <table className="schedule-table" style={{ tableLayout: 'fixed' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '46px' }}>TB</th>
                          <th style={{ width: '56px' }}>Time</th>
                          <th style={{ width: '90px', color: '#94a3b8', fontSize: '11px' }}>WS 2024 (m/s)</th>
                          <th style={{ width: '90px', color: '#94a3b8', fontSize: '11px' }}>WS 2025 (m/s)</th>
                          <th style={{ width: '110px', color: '#00d2ff' }}>↗ Wind Speed (m/s)</th>
                          <th style={{ width: '120px', color: '#00d2ff' }}>Wind Gen MW</th>
                          <th style={{ width: '120px', color: 'var(--color-solar)' }}>Solar Gen MW</th>
                          <th style={{ width: '80px', color: '#64748b', fontSize: '11px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rawForecast.map((row) => {
                          const edit = genTableEdits[row.block] ?? {};
                          const isModified = !!genTableEdits[row.block];
                          const isCurtailed = row.curtail_flag;

                          // Effective values (edit takes priority over raw)
                          const effWindSpeed = edit.wind_speed !== undefined ? edit.wind_speed : row.wind_speed.toFixed(2);
                          const effWindMW = edit.wind_speed !== undefined && edit.wind_speed !== ''
                            ? lookupWindMW(parseFloat(edit.wind_speed), wtgCount)
                            : row.wind_mw_raw;
                          const effSolarMW = edit.solar_mw !== undefined ? edit.solar_mw : row.solar_mw_raw.toFixed(3);

                          const rowBg = isModified
                            ? 'rgba(245,158,11,0.07)'
                            : isCurtailed ? 'rgba(239,68,68,0.03)' : 'transparent';

                          const cellInputStyle = (color: string, modified: boolean): React.CSSProperties => ({
                            width: '100%',
                            background: modified ? 'rgba(245,158,11,0.08)' : '#0a1020',
                            border: `1px solid ${modified ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.07)'}`,
                            borderRadius: '5px',
                            color: modified ? '#fbbf24' : color,
                            padding: '4px 7px',
                            fontSize: '12px',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: modified ? '700' : '400',
                            outline: 'none',
                            transition: 'border-color 0.15s',
                          });

                          const handlePaste = (e: React.ClipboardEvent, startBlock: number) => {
                            e.preventDefault();
                            const text = e.clipboardData.getData('text');
                            const lines = text.trim().split(/\r?\n/);
                            const newEdits = { ...genTableEdits };
                            lines.forEach((line, i) => {
                              const targetBlock = startBlock + i;
                              const cols = line.split('\t');
                              if (cols.length === 0) return;
                              const wsStr = cols[0]?.trim();
                              const solStr = cols[1]?.trim();
                              if (wsStr || solStr) {
                                newEdits[targetBlock] = {
                                  ...(newEdits[targetBlock] ?? {}),
                                  ...(wsStr ? { wind_speed: wsStr } : {}),
                                  ...(solStr ? { solar_mw: solStr } : {}),
                                };
                              }
                            });
                            setGenTableEdits(newEdits);
                          };

                          return (
                            <tr key={row.block} className={isModified ? 'gen-modified-row' : ''} style={{ background: rowBg, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td className="mono-col" style={{ color: isModified ? '#fbbf24' : '#64748b', fontWeight: isModified ? '700' : '400' }}>{row.block}</td>
                              <td className="mono-col" style={{ color: '#64748b' }}>{row.time.substring(0, 5)}</td>

                              {/* Historical wind speeds — read-only */}
                              <td className="mono-col" style={{ color: '#475569', fontSize: '12px' }}>{row.wind_speed_2024.toFixed(2)}</td>
                              <td className="mono-col" style={{ color: '#475569', fontSize: '12px' }}>{row.wind_speed_2025.toFixed(2)}</td>

                              {/* Projected Wind Speed — editable */}
                              <td style={{ padding: '4px 8px' }}>
                                {isCurtailed ? (
                                  <span style={{ color: '#334155', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>✂ curtailed</span>
                                ) : (
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="25"
                                    value={effWindSpeed}
                                    style={cellInputStyle('#00d2ff', edit.wind_speed !== undefined)}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setGenTableEdits(prev => ({ ...prev, [row.block]: { ...(prev[row.block] ?? {}), wind_speed: v } }));
                                    }}
                                    onPaste={e => handlePaste(e, row.block)}
                                    onFocus={e => (e.target.style.borderColor = 'rgba(0,210,255,0.5)')}
                                    onBlur={e => (e.target.style.borderColor = edit.wind_speed !== undefined ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.07)')}
                                  />
                                )}
                              </td>

                              {/* Wind Gen MW — auto-calculated, read-only display */}
                              <td style={{ padding: '4px 8px' }}>
                                {isCurtailed ? (
                                  <span style={{ color: 'var(--color-wind)', fontWeight: '600', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>0.000 ✂</span>
                                ) : (
                                  <div style={{
                                    padding: '4px 7px',
                                    background: edit.wind_speed !== undefined ? 'rgba(0,210,255,0.06)' : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${edit.wind_speed !== undefined ? 'rgba(0,210,255,0.25)' : 'rgba(255,255,255,0.04)'}`,
                                    borderRadius: '5px',
                                    fontSize: '12px',
                                    fontFamily: 'JetBrains Mono, monospace',
                                    color: edit.wind_speed !== undefined ? '#00d2ff' : '#475569',
                                    fontWeight: edit.wind_speed !== undefined ? '700' : '400',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}>
                                    {effWindMW.toFixed(3)}
                                    {edit.wind_speed !== undefined && <span style={{ fontSize: '9px', color: '#00d2ff', opacity: 0.7 }}>↺PC</span>}
                                  </div>
                                )}
                              </td>

                              {/* Solar Gen MW — editable */}
                              <td style={{ padding: '4px 8px' }}>
                                {isCurtailed ? (
                                  <span style={{ color: 'var(--color-solar)', fontWeight: '600', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>0.000 ✂</span>
                                ) : (
                                  <input
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    value={effSolarMW}
                                    style={cellInputStyle('var(--color-solar)', edit.solar_mw !== undefined)}
                                    onChange={e => {
                                      const v = e.target.value;
                                      setGenTableEdits(prev => ({ ...prev, [row.block]: { ...(prev[row.block] ?? {}), solar_mw: v } }));
                                    }}
                                    onPaste={e => handlePaste(e, row.block)}
                                    onFocus={e => (e.target.style.borderColor = 'rgba(245,158,11,0.5)')}
                                    onBlur={e => (e.target.style.borderColor = edit.solar_mw !== undefined ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.07)')}
                                  />
                                )}
                              </td>

                              {/* Status */}
                              <td>
                                {isCurtailed ? (
                                  <span className="cell-badge curtail" style={{ fontSize: '10px' }}>Curtailed</span>
                                ) : isModified ? (
                                  <span className="cell-badge" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', fontSize: '10px' }}>Edited</span>
                                ) : (
                                  <span style={{ color: '#334155', fontSize: '11px' }}>Forecast</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer note */}
                  <div style={{ marginTop: '10px', fontSize: '11px', color: '#334155', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <span>Turbine: Siemens Gamesa SG 3.15-114 · Cut-in 3 m/s · Rated 11 m/s · Cut-out 18 m/s · {wtgCount} WTGs</span>
                    <span>Projected speed = 0.8 × WS₂₀₂₅ + 0.2 × WS₂₀₂₄ (base forecast)</span>
                    <span style={{ color: '#475569' }}>↺PC = recalculated from power curve</span>
                  </div>
                </>
              )}
            </section>
          )}

        </div>
      </main>


      {/* Modern Premium Footer */}
      <footer style={{ marginTop: '40px', borderTop: '1px solid var(--border-color)', padding: '24px 0', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
        <p style={{ margin: 0 }}>RE-RTC Optimizer Engine v1.0.0 • Phase 1 Interactive Simulation Console</p>
        <p style={{ margin: '6px 0 0 0' }}>Approved under Central Electricity Regulatory Commission (CERC) General Network Access (GNA) Regulations. Orvakallu PSP connected via Southern Grid (SR); Fatehgarh Wind-Solar connected via Western Grid (WR).</p>
      </footer>
    </div>
  );
}
