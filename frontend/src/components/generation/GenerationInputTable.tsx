import React, { useRef } from 'react';
import { useOptimizer } from '../../context/OptimizerContext';
import { lookupWindMW } from '../../utils/powerCurve';

export default function GenerationInputTable() {
  const {
    rawForecast, genTableEdits, setGenTableEdits,
    genTableExpanded, setGenTableExpanded, wtgCount,
  } = useOptimizer();

  const genTableRef = useRef<HTMLDivElement>(null);

  if (rawForecast.length === 0) return null;

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

                  const effWindSpeed = edit.wind_speed !== undefined ? edit.wind_speed : row.wind_speed.toFixed(2);
                  const effWindMW = edit.wind_speed !== undefined && edit.wind_speed !== ''
                    ? lookupWindMW(parseFloat(edit.wind_speed), wtgCount)
                    : row.wind_mw_raw;
                  const effSolarMW = edit.solar_mw !== undefined ? edit.solar_mw : row.solar_mw_raw.toFixed(3);

                  const rowBg = isModified
                    ? 'rgba(245,158,11,0.07)'
                    : isCurtailed ? 'rgba(239,68,68,0.03)' : 'transparent';

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

                      {/* Wind Gen MW — auto-calculated */}
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
  );
}
