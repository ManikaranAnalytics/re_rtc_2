import React from 'react';
import { Calendar, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';
import { JUNE_DATES } from '../../utils/constants';

export default function ConfigPanel() {
  const {
    selectedDate, setSelectedDate,
    wtgCount, setWtgCount,
    solarAc, setSolarAc,
    rtcCommitment, setRtcCommitment,
    rtcRange, rangeLoading, rangeExpanded, setRangeExpanded,
  } = useOptimizer();

  return (
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
        <select className="date-select" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}>
          {JUNE_DATES.map(date => (
            <option key={date} value={date}>
              {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </option>
          ))}
        </select>
      </div>

      {/* WTG Slider */}
      <div className="config-group">
        <div className="config-label-area">
          <span className="config-label">Wind Turbines (WTGs)</span>
          <span className="config-value" style={{ color: 'var(--color-wind)' }}>{wtgCount} Units</span>
        </div>
        <input type="range" min="1" max="59" className="range-slider" value={wtgCount} onChange={(e) => setWtgCount(parseInt(e.target.value))} style={{ '--color-wind': 'var(--color-wind)' } as React.CSSProperties} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          <span>1 WTG (3.15 MW)</span>
          <span>Total Capacity: {(wtgCount * 3.15).toFixed(1)} MW</span>
        </div>
      </div>

      {/* Solar AC Slider */}
      <div className="config-group">
        <div className="config-label-area">
          <span className="config-label">Solar Net Capacity</span>
          <span className="config-value" style={{ color: 'var(--color-solar)' }}>{solarAc} MW AC</span>
        </div>
        <input type="range" min="5" max="175" className="range-slider" value={solarAc} onChange={(e) => setSolarAc(parseInt(e.target.value))} style={{ '--color-wind': 'var(--color-solar)' } as React.CSSProperties} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          <span>5 MW AC</span>
          <span>Max: 175 MW AC (PPA base)</span>
        </div>
      </div>

      {/* RTC Commitment Slider */}
      <div className="config-group">
        <div className="config-label-area">
          <span className="config-label">RTC Commitment</span>
          <span className="config-value" style={{ color: 'var(--color-target)' }}>{rtcCommitment.toFixed(1)} MW</span>
        </div>
        <input type="range" min="1.0" max="100.0" step="0.5" className="range-slider" value={rtcCommitment} onChange={(e) => setRtcCommitment(parseFloat(e.target.value))} style={{ '--color-wind': 'var(--color-target)' } as React.CSSProperties} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          <span>1.0 MW</span>
          <span>Max PPA Limit: 100.0 MW</span>
        </div>
      </div>

      {/* ── RTC Suggestion Card ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(16,185,129,0.08) 100%)',
        border: '1px solid rgba(99,102,241,0.28)',
        borderRadius: '12px',
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden'
      }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Min */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: '8px', padding: '8px 12px' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Min Safe Commit</div>
                      <div style={{ fontSize: '20px', fontWeight: '800', color: '#f87171', fontFamily: 'monospace' }}>{rtcRange.min_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>75% of P10 non-curtail gen</div>
                    </div>
                    <button onClick={() => setRtcCommitment(rtcRange.min_rtc_mw)} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}>Use Min</button>
                  </div>

                  {/* Recommended */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '8px 12px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '-8px', right: '10px', background: 'linear-gradient(90deg,#10b981,#059669)', borderRadius: '4px', fontSize: '9px', padding: '2px 6px', color: '#fff', fontWeight: '700', letterSpacing: '0.5px' }}>RECOMMENDED</div>
                    <div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Optimal Commit</div>
                      <div style={{ fontSize: '22px', fontWeight: '800', color: '#34d399', fontFamily: 'monospace' }}>{rtcRange.recommended_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Max RTC → 0 shortfall blocks (dispatch-validated)</div>
                    </div>
                    <button onClick={() => setRtcCommitment(rtcRange.recommended_rtc_mw)} style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.35)', borderRadius: '6px', color: '#34d399', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}>✓ Use This</button>
                  </div>

                  {/* Max */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.20)', borderRadius: '8px', padding: '8px 12px' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>Max Aggressive</div>
                      <div style={{ fontSize: '20px', fontWeight: '800', color: '#818cf8', fontFamily: 'monospace' }}>{rtcRange.max_rtc_mw.toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '400' }}>MW</span></div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>P90 non-curtail gen (PSP backup)</div>
                    </div>
                    <button onClick={() => setRtcCommitment(rtcRange.max_rtc_mw)} style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', color: '#818cf8', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' }}>Use Max</button>
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
    </aside>
  );
}
