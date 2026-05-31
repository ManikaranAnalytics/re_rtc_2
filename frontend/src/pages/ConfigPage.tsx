import React from 'react';
import { Settings2, Table2 } from 'lucide-react';
import { useOptimizer } from '../context/OptimizerContext';

export default function ConfigPage() {
  const {
    maxSocMwh, setMaxSocMwh,
    curtailmentEnabled, setCurtailmentEnabled,
    curtailmentStart, setCurtailmentStart,
    curtailmentEnd, setCurtailmentEnd,
    roundtripLoss, setRoundtripLoss,
    sideTab, setSideTab,
    blockOverrides, setBlockOverrides,
    blocks,
    carryFromDate, initialSocMwh,
    handleClearCarry,
  } = useOptimizer();

  return (
    <div className="config-page">
      <div className="page-header-bar">
        <h2 className="page-heading">Advanced Configuration</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Curtailment windows, PSP parameters, block-level overrides, and carry-forward settings.
        </p>
      </div>

      {/* Two-column card layout */}
      <div className="config-page-grid">

        {/* ─── Left Column: PSP & Curtailment ─── */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings2 size={16} style={{ color: '#a5b4fc' }} />
            Plant & Storage Parameters
          </h3>

          {/* Curtailment Config */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '10px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Curtailment Window</span>
              <button onClick={() => setCurtailmentEnabled(p => !p)} style={{ background: curtailmentEnabled ? 'rgba(251,191,36,0.2)' : 'rgba(100,116,139,0.15)', border: `1px solid ${curtailmentEnabled ? 'rgba(251,191,36,0.5)' : 'rgba(100,116,139,0.3)'}`, borderRadius: '20px', color: curtailmentEnabled ? '#fbbf24' : '#64748b', fontSize: '11px', padding: '4px 12px', cursor: 'pointer', fontWeight: '700' }}>
                {curtailmentEnabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>
            {curtailmentEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>From Block</div>
                  <input type="number" min={1} max={96} value={curtailmentStart} onChange={e => setCurtailmentStart(parseInt(e.target.value))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', color: '#fbbf24', padding: '10px 12px', fontSize: '16px', fontWeight: '700', textAlign: 'center' }} />
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', textAlign: 'center' }}>≈ {((curtailmentStart - 1) * 15 / 60).toFixed(1).replace('.0', ':00').replace('.5', ':30')}h IST</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>To Block</div>
                  <input type="number" min={1} max={96} value={curtailmentEnd} onChange={e => setCurtailmentEnd(parseInt(e.target.value))} style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '8px', color: '#fbbf24', padding: '10px 12px', fontSize: '16px', fontWeight: '700', textAlign: 'center' }} />
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', textAlign: 'center' }}>≈ {Math.floor(curtailmentEnd * 15 / 60).toString().padStart(2, '0')}:{((curtailmentEnd * 15 % 60) === 0 ? '00' : '30')}h IST</div>
                </div>
              </div>
            )}
            {!curtailmentEnabled && <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '8px 0' }}>No curtailment — full generation all 96 blocks</div>}
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

          {/* PSP Max Capacity */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">PSP Max Capacity</span>
              <span className="config-value" style={{ color: '#a78bfa' }}>{maxSocMwh.toFixed(0)} MWh</span>
            </div>
            <input type="range" min="10" max="360" step="5" className="range-slider" value={maxSocMwh} onChange={e => setMaxSocMwh(parseFloat(e.target.value))} style={{ '--color-wind': '#a78bfa' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>10 MWh (min)</span>
              <span style={{ color: maxSocMwh === 360 ? '#64748b' : '#f59e0b' }}>
                {maxSocMwh < 360 ? `${(360 - maxSocMwh).toFixed(0)} MWh below ceiling` : 'Full 360 MWh (CERC cap)'}
              </span>
            </div>
          </div>

          {/* SoC Carry-Forward info */}
          <div style={{
            background: carryFromDate ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${carryFromDate ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '10px',
            padding: '16px'
          }}>
            <div style={{ fontWeight: '700', color: carryFromDate ? '#34d399' : '#64748b', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>⚡ SoC Carry-Forward</div>
            {carryFromDate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>Carrying from <span style={{ color: '#34d399', fontWeight: '600' }}>{carryFromDate}</span></div>
                <div style={{ fontSize: '14px', color: '#e2e8f0' }}>Starting SoC: <span style={{ color: '#34d399', fontWeight: '700' }}>{initialSocMwh.toFixed(1)} MWh</span></div>
                <button onClick={handleClearCarry} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '12px', padding: '6px 14px', cursor: 'pointer', fontWeight: '600', alignSelf: 'flex-start' }}>✕ Clear — Start Fresh</button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.6' }}>Each day starts fresh at SoC = 0 MWh.<br />Use <strong style={{ color: '#94a3b8' }}>Roll to Next Day →</strong> on the dispatch page to carry SoC.</div>
            )}
          </div>

          {/* Regulatory Constraints */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <span style={{ fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px', fontSize: '14px' }}>Regulatory Constraints:</span>
            <ul style={{ paddingLeft: '18px', margin: 0 }}>
              <li style={{ marginBottom: '6px' }}>Curtailment: {curtailmentEnabled ? `Blocks ${curtailmentStart}–${curtailmentEnd}` : 'Disabled this season'}.</li>
              <li style={{ marginBottom: '6px' }}>Orvakallu PSP storage capacity capped at 360 MWh.</li>
              <li>Min delivery floor: 75% of RTC commitment.</li>
            </ul>
          </div>
        </div>

        {/* ─── Right Column: Block-Level Data Overrides ─── */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Table2 size={16} style={{ color: '#fbbf24' }} />
              Block-Level Overrides
            </h3>
            {Object.keys(blockOverrides).length > 0 && (
              <button onClick={() => setBlockOverrides({})} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '12px', padding: '5px 12px', cursor: 'pointer', fontWeight: '600' }}>Clear All ({Object.keys(blockOverrides).length})</button>
            )}
          </div>

          <div style={{ fontSize: '12px', color: '#64748b', padding: '8px 12px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '8px' }}>
            Override Wind/Solar MW per block — leave blank to use forecast values. Changes auto-sync to the optimizer.
          </div>

          <div className="table-container" style={{ maxHeight: '520px' }}>
            <table className="schedule-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '70px' }}>Block</th>
                  <th style={{ color: '#00b4d8' }}>Wind MW Override</th>
                  <th style={{ color: '#f59e0b' }}>Solar MW Override</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.block} style={{ background: b.curtail_flag ? 'rgba(51,65,85,0.3)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ color: '#64748b', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>
                      {b.block} <span style={{ fontSize: '10px', color: '#475569' }}>{b.time.substring(0, 5)}</span>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        placeholder={b.wind_mw.toFixed(2)}
                        value={blockOverrides[b.block]?.wind_mw ?? ''}
                        onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, wind_mw: e.target.value } }))}
                        style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(0,180,216,0.2)', borderRadius: '6px', color: '#00d2ff', padding: '6px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        placeholder={b.solar_mw.toFixed(2)}
                        value={blockOverrides[b.block]?.solar_mw ?? ''}
                        onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, solar_mw: e.target.value } }))}
                        style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', color: '#f59e0b', padding: '6px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
