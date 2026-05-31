import React, { useState, useCallback } from 'react';
import { Chart } from 'react-chartjs-2';
import '../../utils/chartSetup';
import { useOptimizer } from '../../context/OptimizerContext';
import { BASE_URL, JUNE_DATES } from '../../utils/constants';
import type { ScheduleResponse, BlockData } from '../../types';

/* ───────── Types ───────── */

interface DayResult {
  date: string;
  schedule: ScheduleResponse;
}

/* ───────── Component ───────── */

export default function MultiDayAnalysis() {
  const {
    wtgCount, solarAc, rtcCommitment, maxSocMwh,
    curtailmentEnabled, curtailmentStart, curtailmentEnd,
    roundtripLoss,
  } = useOptimizer();

  // Multi-day config
  const [startDate, setStartDate] = useState('2026-06-01');
  const [numDays, setNumDays] = useState(7);

  // Results
  const [results, setResults] = useState<DayResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  // Chart view toggle
  const [chartView, setChartView] = useState<'soc' | 'dispatch' | 'compliance'>('soc');

  // Max selectable days from startDate
  const maxDays = Math.min(30, JUNE_DATES.length - JUNE_DATES.indexOf(startDate));

  const runAnalysis = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    setError('');
    setResults([]);

    const dayResults: DayResult[] = [];
    let currentSocMwh = 0;
    let prevChargeSchedule: number[] | null = null;

    try {
      for (let i = 0; i < numDays; i++) {
        const dateIndex = JUNE_DATES.indexOf(startDate) + i;
        if (dateIndex >= JUNE_DATES.length) break;
        const date = JUNE_DATES[dateIndex];

        const response = await fetch(`${BASE_URL}/api/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
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
            initial_soc_mwh: currentSocMwh,
            prev_day_charge_schedule: prevChargeSchedule,
          })
        });

        if (!response.ok) throw new Error(`Failed for ${date}: ${response.statusText}`);
        const data: ScheduleResponse = await response.json();
        dayResults.push({ date, schedule: data });

        // Carry forward
        currentSocMwh = data.summary.end_soc_mwh;
        prevChargeSchedule = data.carry_forward?.today_charge_schedule ?? null;

        setProgress(((i + 1) / numDays) * 100);
        setResults([...dayResults]); // progressive render
      }
    } catch (err: any) {
      setError(err.message || 'Multi-day analysis failed');
    } finally {
      setIsRunning(false);
    }
  }, [startDate, numDays, wtgCount, solarAc, rtcCommitment, curtailmentEnabled, curtailmentStart, curtailmentEnd, roundtripLoss, maxSocMwh]);

  // ── Aggregated Metrics ──
  const n = results.length || 1;
  const totalBlocks = results.reduce((s, r) => s + r.schedule.summary.total_blocks, 0);
  const compliantBlocks = results.reduce((s, r) => s + r.schedule.summary.compliant_blocks, 0);
  const totalChargedMwh = results.reduce((s, r) => s + r.schedule.summary.total_charged_mwh, 0);
  const totalDischargedMwh = results.reduce((s, r) => s + r.schedule.summary.total_discharged_mwh, 0);
  const totalRtmSurplus = results.reduce((s, r) => s + r.schedule.summary.total_rtm_surplus_mwh, 0);
  const totalCycles = results.reduce((s, r) => s + r.schedule.summary.cycles_used, 0);

  // ── Average Metrics ──
  const avgDailyCharge = totalChargedMwh / n;
  const avgDailyDischarge = totalDischargedMwh / n;
  const avgDailyCycles = totalCycles / n;
  const avgDailyRtm = totalRtmSurplus / n;

  // ── Generation stats across all blocks ──
  const allNetSchedules = results.flatMap(r => r.schedule.blocks.map(b => b.net_schedule));
  const sortedNet = [...allNetSchedules].sort((a, b) => a - b);
  const pctile = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)] ?? 0;

  const genP10 = sortedNet.length > 0 ? pctile(sortedNet, 10) : 0;
  const genP50 = sortedNet.length > 0 ? pctile(sortedNet, 50) : 0;
  const genP90 = sortedNet.length > 0 ? pctile(sortedNet, 90) : 0;
  const genMin = sortedNet.length > 0 ? sortedNet[0] : 0;

  // ── Per-day min net schedule (bottleneck block per day) ──
  const perDayMinNet = results.map(r => ({
    date: r.date,
    min: Math.min(...r.schedule.blocks.map(b => b.net_schedule)),
    avg: r.schedule.blocks.reduce((s, b) => s + b.net_schedule, 0) / r.schedule.blocks.length,
    compliant: r.schedule.summary.fully_compliant,
  }));

  // ── RTC Suggestion ──
  // Max safe RTC = worst day's min net_schedule ÷ 0.75 (compliance floor rule)
  const worstDay = perDayMinNet.reduce((w, d) => d.min < w.min ? d : w, perDayMinNet[0] ?? { date: '', min: 0, avg: 0, compliant: false });
  const maxSafeRtc = results.length > 0 ? Math.max(0, worstDay.min / 0.75) : 0;
  // Conservative = P10 net schedule ÷ 0.75
  const conservativeRtc = results.length > 0 ? Math.max(0, genP10 / 0.75) : 0;
  // Optimal = max RTC that keeps every block above 75% → the global min net_schedule / 0.75
  const optimalRtc = results.length > 0 ? Math.max(0, genMin / 0.75) : 0;

  const dateLabel = (d: string) => d.replace('2026-06-', 'Jun ');
  const periodLabel = results.length > 0
    ? `${dateLabel(results[0].date)} – ${dateLabel(results[results.length - 1].date)}`
    : '';

  // ── Combined SoC Data ──
  const allBlocks: { block: BlockData; date: string; globalIndex: number }[] = [];
  results.forEach((r, dayIdx) => {
    r.schedule.blocks.forEach((b, blockIdx) => {
      allBlocks.push({ block: b, date: r.date, globalIndex: dayIdx * 96 + blockIdx });
    });
  });

  // ── Chart: SoC Timeline ──
  const socLabels = allBlocks.filter((_, i) => i % 4 === 0).map(ab => {
    const dayLabel = ab.date.replace('2026-06-', 'Jun ');
    return ab.block.time.substring(0, 5) === '00:00' ? dayLabel : ab.block.time.substring(0, 5);
  });

  const socChartData = {
    labels: allBlocks.map((ab, i) => {
      if (i % 4 !== 0) return '';
      return ab.block.time.substring(0, 5) === '00:00'
        ? ab.date.replace('2026-06-', 'Jun ')
        : ab.block.time.substring(0, 5);
    }),
    datasets: [
      {
        type: 'line' as const,
        label: 'State of Charge (MWh)',
        data: allBlocks.map(ab => ab.block.soc_end),
        borderColor: '#8b5cf6',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        fill: true,
        backgroundColor: 'rgba(139, 92, 246, 0.10)',
        tension: 0.2,
      },
      {
        type: 'line' as const,
        label: `Max Capacity (${maxSocMwh} MWh)`,
        data: allBlocks.map(() => maxSocMwh),
        borderColor: 'rgba(100, 116, 139, 0.4)',
        borderWidth: 1,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  // ── Chart: Dispatch Timeline ──
  const dispatchChartData = {
    labels: allBlocks.map((ab, i) => {
      if (i % 4 !== 0) return '';
      return ab.block.time.substring(0, 5) === '00:00'
        ? ab.date.replace('2026-06-', 'Jun ')
        : ab.block.time.substring(0, 5);
    }),
    datasets: [
      {
        type: 'bar' as const,
        label: 'Wind MW',
        data: allBlocks.map(ab => ab.block.wind_mw),
        backgroundColor: 'rgba(0, 210, 255, 0.6)',
        borderWidth: 0,
        stack: 'gen',
        barPercentage: 1,
        categoryPercentage: 1,
      },
      {
        type: 'bar' as const,
        label: 'Solar MW',
        data: allBlocks.map(ab => ab.block.solar_mw),
        backgroundColor: 'rgba(245, 158, 11, 0.6)',
        borderWidth: 0,
        stack: 'gen',
        barPercentage: 1,
        categoryPercentage: 1,
      },
      {
        type: 'bar' as const,
        label: 'PSP Discharge MW',
        data: allBlocks.map(ab => ab.block.psp_discharge),
        backgroundColor: 'rgba(139, 92, 246, 0.6)',
        borderWidth: 0,
        stack: 'gen',
        barPercentage: 1,
        categoryPercentage: 1,
      },
      {
        type: 'line' as const,
        label: 'Net Schedule (MW)',
        data: allBlocks.map(ab => ab.block.net_schedule),
        borderColor: '#10b981',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
      {
        type: 'line' as const,
        label: `RTC Target (${rtcCommitment} MW)`,
        data: allBlocks.map(() => rtcCommitment),
        borderColor: 'rgba(239, 68, 68, 0.6)',
        borderWidth: 1.5,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  // ── Chart: Daily Compliance ──
  const complianceChartData = {
    labels: results.map(r => r.date.replace('2026-06-', 'Jun ')),
    datasets: [
      {
        type: 'bar' as const,
        label: 'Compliant Blocks',
        data: results.map(r => r.schedule.summary.compliant_blocks),
        backgroundColor: results.map(r =>
          r.schedule.summary.fully_compliant ? 'rgba(16,185,129,0.7)' : 'rgba(245,158,11,0.7)'
        ),
        borderColor: results.map(r =>
          r.schedule.summary.fully_compliant ? 'rgba(16,185,129,0.9)' : 'rgba(245,158,11,0.9)'
        ),
        borderWidth: 1,
        borderRadius: 6,
      },
      {
        type: 'line' as const,
        label: 'EOD SoC (MWh)',
        data: results.map(r => r.schedule.summary.end_soc_mwh),
        borderColor: '#a78bfa',
        borderWidth: 2,
        pointRadius: 5,
        pointBackgroundColor: '#a78bfa',
        fill: false,
        yAxisID: 'y1',
      },
    ],
  };

  const timelineChartOptions = {
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
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#64748b',
          font: { family: 'Outfit', size: 9 },
          maxTicksLimit: 28,
          autoSkip: true,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } },
        title: { display: true, text: 'MWh / MW', color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
      },
    },
  };

  const complianceChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(13, 20, 38, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        min: 0, max: 96,
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } },
        title: { display: true, text: 'Compliant Blocks (/96)', color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
      },
      y1: {
        position: 'right' as const,
        grid: { display: false },
        ticks: { color: '#a78bfa', font: { family: 'Outfit', size: 10 } },
        title: { display: true, text: 'EOD SoC (MWh)', color: '#a78bfa', font: { family: 'Outfit', size: 11 } },
      },
    },
  };

  return (
    <div className="multiday-page">

      {/* ─── Config Bar ─── */}
      <div className="multiday-config-bar glass-panel">
        <div className="multiday-config-grid">
          <div className="config-group" style={{ gap: '6px' }}>
            <span className="config-label">Start Date</span>
            <select className="date-select" value={startDate} onChange={e => setStartDate(e.target.value)}>
              {JUNE_DATES.map(d => (
                <option key={d} value={d}>{new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</option>
              ))}
            </select>
          </div>

          <div className="config-group" style={{ gap: '6px' }}>
            <span className="config-label">Duration (days)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="range" min="2" max={maxDays} step="1"
                className="range-slider"
                value={numDays}
                onChange={e => setNumDays(parseInt(e.target.value))}
                style={{ '--color-wind': '#818cf8', flex: 1 } as React.CSSProperties}
              />
              <span style={{ color: '#818cf8', fontWeight: '700', fontSize: '18px', fontFamily: 'monospace', minWidth: '32px' }}>{numDays}</span>
            </div>
          </div>

          <div className="config-group" style={{ gap: '6px' }}>
            <span className="config-label">Using Config</span>
            <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.6' }}>
              WTG: <strong style={{ color: '#00d2ff' }}>{wtgCount}</strong> · Solar: <strong style={{ color: '#f59e0b' }}>{solarAc} MW</strong> · RTC: <strong style={{ color: '#ef4444' }}>{rtcCommitment.toFixed(1)} MW</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={runAnalysis}
              disabled={isRunning}
              className="btn-primary"
              style={{ width: '100%', padding: '10px 20px', fontSize: '14px' }}
            >
              {isRunning ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                  <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', animation: 'spin 1s linear infinite' }} />
                  Optimizing Day {Math.ceil(progress / (100 / numDays))} / {numDays}...
                </span>
              ) : (
                `▶ Run ${numDays}-Day Analysis`
              )}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div style={{ marginTop: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden', height: '6px' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg, #818cf8, #10b981)', borderRadius: '6px', transition: 'width 0.3s ease' }} />
          </div>
        )}

        {error && (
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#f87171', fontSize: '13px' }}>
            {error}
          </div>
        )}
      </div>

      {/* ─── Results ─── */}
      {results.length > 0 && (
        <>
          {/* Aggregated KPIs — Totals Row */}
          <div className="multiday-kpi-grid">
            {[
              { label: 'Period', value: periodLabel, unit: '', color: '#818cf8', mono: false },
              { label: 'Overall Compliance', value: ((compliantBlocks / totalBlocks) * 100).toFixed(1), unit: '%', color: compliantBlocks === totalBlocks ? '#34d399' : '#f59e0b', mono: true },
              { label: 'Compliant Blocks', value: compliantBlocks, unit: ` / ${totalBlocks}`, color: '#34d399', mono: true },
              { label: 'Fully Compliant Days', value: results.filter(r => r.schedule.summary.fully_compliant).length, unit: ` / ${results.length}`, color: '#10b981', mono: true },
            ].map(kpi => (
              <div key={kpi.label} className="glass-panel multiday-kpi-card">
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>{kpi.label}</div>
                <div style={{ fontSize: kpi.mono === false ? '16px' : '24px', fontWeight: '800', color: kpi.color, fontFamily: kpi.mono === false ? 'var(--font-sans)' : 'JetBrains Mono, monospace' }}>
                  {kpi.value}<span style={{ fontSize: '13px', fontWeight: '400', color: '#64748b' }}>{kpi.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Aggregated KPIs — PSP & Averages Row */}
          <div className="multiday-kpi-grid">
            {[
              { label: 'Avg Daily Charge', value: avgDailyCharge.toFixed(1), unit: ' MWh', color: '#ec4899' },
              { label: 'Avg Daily Discharge', value: avgDailyDischarge.toFixed(1), unit: ' MWh', color: '#a78bfa' },
              { label: 'Avg PSP Cycles/Day', value: avgDailyCycles.toFixed(2), unit: '', color: '#8b5cf6' },
              { label: 'Avg RTM Surplus/Day', value: avgDailyRtm.toFixed(1), unit: ' MWh', color: '#64748b' },
              { label: 'Total Charged', value: totalChargedMwh.toFixed(1), unit: ' MWh', color: '#ec4899' },
              { label: 'Total Discharged', value: totalDischargedMwh.toFixed(1), unit: ' MWh', color: '#a78bfa' },
              { label: 'Total Cycles', value: totalCycles.toFixed(2), unit: '', color: '#8b5cf6' },
              { label: 'Total RTM Surplus', value: totalRtmSurplus.toFixed(1), unit: ' MWh', color: '#64748b' },
            ].map(kpi => (
              <div key={kpi.label} className="glass-panel multiday-kpi-card">
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>{kpi.label}</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: kpi.color, fontFamily: 'JetBrains Mono, monospace' }}>
                  {kpi.value}<span style={{ fontSize: '13px', fontWeight: '400', color: '#64748b' }}>{kpi.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ─── RTC Optimal Suggestion Card ─── */}
          <div className="glass-panel" style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(16,185,129,0.06) 100%)',
            border: '1px solid rgba(99,102,241,0.25)',
            padding: '24px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: '-30px', right: '-30px', width: '120px', height: '120px', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>💡</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  RTC Optimal Suggestion
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Based on {results.length}-day analysis ({periodLabel}) with current plant config
                </p>
              </div>
            </div>

            {/* Suggestion cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              {/* Max Safe */}
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', padding: '14px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '-7px', right: '10px', background: 'linear-gradient(90deg,#10b981,#059669)', borderRadius: '4px', fontSize: '9px', padding: '2px 6px', color: '#fff', fontWeight: '700', letterSpacing: '0.5px' }}>RECOMMENDED</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Max Safe RTC (100% Compliance)</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#34d399', fontFamily: 'JetBrains Mono, monospace' }}>
                  {optimalRtc.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: '400' }}>MW</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Guarantees 0 shortfall blocks across all {results.length} days
                </div>
              </div>

              {/* Conservative */}
              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Conservative (P10 Based)</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace' }}>
                  {conservativeRtc.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: '400' }}>MW</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Based on P10 net delivery across all blocks
                </div>
              </div>

              {/* Currently Used */}
              <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Current Config RTC</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: rtcCommitment <= optimalRtc ? '#34d399' : '#f87171', fontFamily: 'JetBrains Mono, monospace' }}>
                  {rtcCommitment.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: '400' }}>MW</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {rtcCommitment <= optimalRtc
                    ? `✓ Within safe range (headroom: ${(optimalRtc - rtcCommitment).toFixed(1)} MW)`
                    : `⚠ Above safe limit by ${(rtcCommitment - optimalRtc).toFixed(1)} MW`
                  }
                </div>
              </div>
            </div>

            {/* Generation Stats Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px' }}>
              <div style={{ color: '#64748b' }}>Net Schedule Min: <strong style={{ color: '#f87171' }}>{genMin.toFixed(1)} MW</strong></div>
              <div style={{ color: '#64748b' }}>Net Schedule P10: <strong style={{ color: '#cbd5e1' }}>{genP10.toFixed(1)} MW</strong></div>
              <div style={{ color: '#64748b' }}>Net Schedule P50: <strong style={{ color: '#cbd5e1' }}>{genP50.toFixed(1)} MW</strong></div>
              <div style={{ color: '#64748b' }}>Net Schedule P90: <strong style={{ color: '#cbd5e1' }}>{genP90.toFixed(1)} MW</strong></div>
              <div style={{ color: '#64748b' }}>Worst Day: <strong style={{ color: '#f87171' }}>{worstDay.date ? dateLabel(worstDay.date) : '–'}</strong></div>
              <div style={{ color: '#64748b' }}>Worst Block Floor: <strong style={{ color: '#f87171' }}>{worstDay.min.toFixed(1)} MW</strong></div>
            </div>
          </div>

          {/* Chart view toggle */}
          <div className="chart-view-tabs">
            {[
              { key: 'soc' as const, label: '🔋 SoC Timeline' },
              { key: 'dispatch' as const, label: '⚡ Dispatch Schedule' },
              { key: 'compliance' as const, label: '✅ Daily Compliance' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setChartView(tab.key)}
                className={`chart-view-tab ${chartView === tab.key ? 'chart-view-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Charts */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            {/* Chart legends */}
            {chartView === 'soc' && (
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <div className="legend-item"><div className="legend-color" style={{ background: '#8b5cf6' }} /><span>SoC (MWh)</span></div>
                <div className="legend-item"><div style={{ width: '12px', height: '2px', borderBottom: '2px dashed rgba(100,116,139,0.5)' }} /><span>Max Capacity</span></div>
              </div>
            )}
            {chartView === 'dispatch' && (
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <div className="legend-item"><div className="legend-color" style={{ background: 'rgba(0,210,255,0.6)' }} /><span>Wind</span></div>
                <div className="legend-item"><div className="legend-color" style={{ background: 'rgba(245,158,11,0.6)' }} /><span>Solar</span></div>
                <div className="legend-item"><div className="legend-color" style={{ background: 'rgba(139,92,246,0.6)' }} /><span>PSP Discharge</span></div>
                <div className="legend-item"><div style={{ width: '12px', height: '3px', background: '#10b981' }} /><span>Net Schedule</span></div>
                <div className="legend-item"><div style={{ width: '12px', height: '2px', borderBottom: '2px dashed rgba(239,68,68,0.6)' }} /><span>RTC Target</span></div>
              </div>
            )}
            {chartView === 'compliance' && (
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <div className="legend-item"><div className="legend-color" style={{ background: 'rgba(16,185,129,0.7)' }} /><span>Compliant Blocks</span></div>
                <div className="legend-item"><div style={{ width: '12px', height: '3px', background: '#a78bfa', borderRadius: '2px' }} /><span>EOD SoC</span></div>
              </div>
            )}

            <div style={{ height: chartView === 'compliance' ? '320px' : '380px', position: 'relative' }}>
              {chartView === 'soc' && (
                <Chart type="line" data={socChartData as any} options={timelineChartOptions as any} />
              )}
              {chartView === 'dispatch' && (
                <Chart type="bar" data={dispatchChartData as any} options={timelineChartOptions as any} />
              )}
              {chartView === 'compliance' && (
                <Chart type="bar" data={complianceChartData as any} options={complianceChartOptions as any} />
              )}
            </div>
          </div>

          {/* ─── Daily Breakdown Table ─── */}
          <div className="glass-panel table-panel">
            <h3 style={{ margin: '0 0 14px', fontSize: '16px', fontWeight: '600' }}>Daily Breakdown</h3>
            <div className="table-container">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Compliant</th>
                    <th>Shortfall</th>
                    <th>Status</th>
                    <th>Charged MWh</th>
                    <th>Discharged MWh</th>
                    <th>PSP Cycles</th>
                    <th>Start SoC</th>
                    <th>End SoC</th>
                    <th>RTM Surplus</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const s = r.schedule.summary;
                    const startSoc = i === 0 ? 0 : results[i - 1].schedule.summary.end_soc_mwh;
                    return (
                      <tr key={r.date} className={s.fully_compliant ? '' : 'shortfall-row'}>
                        <td className="mono-col" style={{ fontWeight: '700', color: '#e2e8f0' }}>{r.date.replace('2026-', '')}</td>
                        <td className="mono-col" style={{ color: '#34d399' }}>{s.compliant_blocks}/96</td>
                        <td className="mono-col" style={{ color: s.fully_compliant ? '#334155' : '#f87171' }}>{96 - s.compliant_blocks}</td>
                        <td>
                          <span className={`cell-badge ${s.fully_compliant ? 'ok' : 'warn'}`}>
                            {s.fully_compliant ? '✓ Pass' : '⚠ Fail'}
                          </span>
                        </td>
                        <td className="mono-col">{s.total_charged_mwh.toFixed(1)}</td>
                        <td className="mono-col">{s.total_discharged_mwh.toFixed(1)}</td>
                        <td className="mono-col">{s.cycles_used.toFixed(2)}</td>
                        <td className="mono-col" style={{ color: '#94a3b8' }}>{startSoc.toFixed(1)}</td>
                        <td className="mono-col" style={{ color: '#a78bfa' }}>{s.end_soc_mwh.toFixed(1)}</td>
                        <td className="mono-col" style={{ color: s.total_rtm_surplus_mwh > 0 ? '#64748b' : '#334155' }}>{s.total_rtm_surplus_mwh.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {results.length > 1 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid rgba(255,255,255,0.1)', fontWeight: '700' }}>
                      <td style={{ color: '#e2e8f0' }}>TOTAL</td>
                      <td className="mono-col" style={{ color: '#34d399' }}>{compliantBlocks}/{totalBlocks}</td>
                      <td className="mono-col" style={{ color: totalBlocks - compliantBlocks > 0 ? '#f87171' : '#334155' }}>{totalBlocks - compliantBlocks}</td>
                      <td>
                        <span className={`cell-badge ${compliantBlocks === totalBlocks ? 'ok' : 'warn'}`}>
                          {((compliantBlocks / totalBlocks) * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="mono-col">{totalChargedMwh.toFixed(1)}</td>
                      <td className="mono-col">{totalDischargedMwh.toFixed(1)}</td>
                      <td className="mono-col">{totalCycles.toFixed(2)}</td>
                      <td className="mono-col" style={{ color: '#94a3b8' }}>0.0</td>
                      <td className="mono-col" style={{ color: '#a78bfa' }}>{results[results.length - 1]?.schedule.summary.end_soc_mwh.toFixed(1)}</td>
                      <td className="mono-col">{totalRtmSurplus.toFixed(1)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {results.length === 0 && !isRunning && (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: '600', color: '#e2e8f0' }}>Multi-Day Dispatch Analysis</h3>
          <p style={{ color: '#64748b', fontSize: '14px', maxWidth: '480px', margin: '0 auto 24px', lineHeight: '1.6' }}>
            Run the optimizer across multiple consecutive days with automatic SoC carry-forward between days. 
            View combined dispatch schedules, SoC trends, and daily compliance at a glance.
          </p>
          <p style={{ color: '#475569', fontSize: '12px' }}>
            Configure the date range above and click <strong style={{ color: '#818cf8' }}>Run Analysis</strong> to begin.
          </p>
        </div>
      )}
    </div>
  );
}
