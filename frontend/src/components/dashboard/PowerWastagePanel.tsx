import { ShieldAlert, Zap, TrendingDown, BarChart3, AlertTriangle } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';

export default function PowerWastagePanel() {
  const { summary, blocks } = useOptimizer();
  if (!summary) return null;

  // ── PSP Wastage ──
  const complianceWasted = summary.compliance_wasted_mwh ?? 0;
  const potentialDischarge = summary.potential_discharge_mwh ?? 0;
  const actualDischarge = summary.total_discharged_mwh ?? 0;

  // ── Non-Compliance Energy Shortage ──
  // Compute directly from block data (same formula as per-row Shortfall MWh column)
  // This is always accurate regardless of whether the backend summary field is populated
  const shortfallEnergyMwh = blocks.length > 0
    ? blocks.reduce((sum, b) => sum + Math.max(0, b.min_schedule - b.net_schedule) * 0.25, 0)
    : (summary.shortfall_energy_mwh ?? 0);
  const nonCompliantBlocks = 96 - summary.compliant_blocks;
  const avgShortfallPerBlock = nonCompliantBlocks > 0 ? shortfallEnergyMwh / nonCompliantBlocks : 0;
  // Worst single-block deficit in MWh (from block data if available)
  const worstBlockMwh = blocks.length > 0
    ? Math.max(0, ...blocks
        .filter(b => !b.compliant)
        .map(b => Math.max(0, b.min_schedule - b.net_schedule) * 0.25)
      )
    : 0;

  // Efficiency ratio: how much of the theoretical discharge was actually dispatched
  const dispatchEfficiency =
    potentialDischarge > 0
      ? Math.min(100, (actualDischarge / potentialDischarge) * 100)
      : 100;

  // How much was lost purely to the CERC 6MW floor rule vs. SoC exhaustion
  const socLimitedLoss = Math.max(0, potentialDischarge - actualDischarge - complianceWasted);

  // Bar widths as percentages of potential
  const actualPct = potentialDischarge > 0 ? (actualDischarge / potentialDischarge) * 100 : 0;
  const compliancePct = potentialDischarge > 0 ? (complianceWasted / potentialDischarge) * 100 : 0;
  const socPct = potentialDischarge > 0 ? (socLimitedLoss / potentialDischarge) * 100 : 0;

  return (
    <section className="glass-panel power-wastage-panel">
      {/* Header */}
      <div className="pw-header">
        <div className="pw-title-group">
          <ShieldAlert size={18} style={{ color: '#f59e0b' }} />
          <h3 className="pw-title">Power Wastage Metrics</h3>
        </div>
        <span className="pw-subtitle">
          PSP dispatch losses &amp; compliance constraints
        </span>
      </div>

      {/* Top KPI row */}
      <div className="pw-kpi-row">
        {/* Card 1 — Compliance Waste */}
        <div className="pw-kpi-card pw-kpi-card--warn">
          <div className="pw-kpi-card-header">
            <ShieldAlert size={14} style={{ color: '#f59e0b' }} />
            <span>Wasted — Compliance Rule</span>
          </div>
          <div className="pw-kpi-card-value">
            <span>{complianceWasted.toFixed(2)}</span>
            <span className="pw-kpi-unit">MWh</span>
          </div>
          <span className="pw-kpi-hint">
            Energy that couldn&apos;t dispatch due to CERC 6 MW minimum floor
          </span>
        </div>

        {/* Card 2 — Potential Discharge */}
        <div className="pw-kpi-card pw-kpi-card--info">
          <div className="pw-kpi-card-header">
            <Zap size={14} style={{ color: '#00d2ff' }} />
            <span>Potential Discharge</span>
          </div>
          <div className="pw-kpi-card-value">
            <span>{potentialDischarge.toFixed(2)}</span>
            <span className="pw-kpi-unit">MWh</span>
          </div>
          <span className="pw-kpi-hint">
            Total shortfall energy requiring PSP support (theoretical maximum)
          </span>
        </div>

        {/* Card 3 — Actual Discharge */}
        <div className="pw-kpi-card pw-kpi-card--success">
          <div className="pw-kpi-card-header">
            <TrendingDown size={14} style={{ color: '#10b981' }} />
            <span>Actual Discharge</span>
          </div>
          <div className="pw-kpi-card-value">
            <span>{actualDischarge.toFixed(2)}</span>
            <span className="pw-kpi-unit">MWh</span>
          </div>
          <span className="pw-kpi-hint">
            Energy successfully dispatched from PSP to grid
          </span>
        </div>

        {/* Card 4 — Dispatch Efficiency */}
        <div className="pw-kpi-card pw-kpi-card--neutral">
          <div className="pw-kpi-card-header">
            <BarChart3 size={14} style={{ color: '#8b5cf6' }} />
            <span>Dispatch Efficiency</span>
          </div>
          <div className="pw-kpi-card-value">
            <span style={{ color: dispatchEfficiency >= 90 ? '#10b981' : dispatchEfficiency >= 70 ? '#f59e0b' : '#ef4444' }}>
              {dispatchEfficiency.toFixed(1)}
            </span>
            <span className="pw-kpi-unit">%</span>
          </div>
          <span className="pw-kpi-hint">
            Actual ÷ potential discharge
          </span>
        </div>
      </div>

      {/* Stacked breakdown bar */}
      <div className="pw-breakdown">
        <div className="pw-breakdown-label">
          <span>Discharge Breakdown</span>
          <span className="pw-breakdown-total">{potentialDischarge.toFixed(2)} MWh potential</span>
        </div>

        {potentialDischarge > 0 ? (
          <>
            <div className="pw-bar-track">
              <div
                className="pw-bar-segment pw-bar-actual"
                style={{ width: `${actualPct}%` }}
                title={`Actual dispatched: ${actualDischarge.toFixed(2)} MWh`}
              />
              <div
                className="pw-bar-segment pw-bar-compliance"
                style={{ width: `${compliancePct}%` }}
                title={`Compliance waste (CERC rule): ${complianceWasted.toFixed(2)} MWh`}
              />
              <div
                className="pw-bar-segment pw-bar-soc"
                style={{ width: `${socPct}%` }}
                title={`SoC-limited loss: ${socLimitedLoss.toFixed(2)} MWh`}
              />
            </div>

            <div className="pw-legend">
              <div className="pw-legend-item">
                <span className="pw-legend-dot pw-legend-dot--actual" />
                <span>Dispatched ({actualDischarge.toFixed(1)} MWh)</span>
              </div>
              <div className="pw-legend-item">
                <span className="pw-legend-dot pw-legend-dot--compliance" />
                <span>Compliance loss ({complianceWasted.toFixed(1)} MWh)</span>
              </div>
              {socLimitedLoss > 0.01 && (
                <div className="pw-legend-item">
                  <span className="pw-legend-dot pw-legend-dot--soc" />
                  <span>SoC-limited ({socLimitedLoss.toFixed(1)} MWh)</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="pw-no-shortfall">
            <span>✓ No shortfall blocks — PSP discharge not required this day</span>
          </div>
        )}
      </div>

      {/* ═══ Non-Compliance Energy Shortage Section ═══ */}
      {nonCompliantBlocks > 0 ? (
        <div style={{
          marginTop: '20px',
          padding: '16px 20px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(220,38,38,0.04) 100%)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '12px',
        }}>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Non-Compliance Energy Shortage
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#64748b' }}>
              {nonCompliantBlocks} of 96 blocks failed
            </span>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>

            {/* Total shortage */}
            <div style={{
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.22)',
              borderRadius: '10px',
              padding: '12px 14px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: '-10px', right: '-10px', width: '60px', height: '60px', background: 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
              <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Total Energy Shortage</div>
              <div style={{ fontSize: '28px', fontWeight: '800', color: '#f87171', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                {shortfallEnergyMwh.toFixed(3)}
              </div>
              <div style={{ fontSize: '12px', color: '#f87171', marginTop: '2px' }}>MWh below compliance floor</div>
            </div>

            {/* Avg per non-compliant block */}
            <div style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: '10px',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Avg Deficit / Block</div>
              <div style={{ fontSize: '28px', fontWeight: '800', color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                {avgShortfallPerBlock.toFixed(3)}
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>MWh per non-compliant block</div>
            </div>

            {/* Worst single block */}
            {worstBlockMwh > 0 && (
              <div style={{
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.15)',
                borderRadius: '10px',
                padding: '12px 14px',
              }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Worst Block Deficit</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                  {worstBlockMwh.toFixed(3)}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>MWh in single worst block</div>
              </div>
            )}

            {/* Context: % of RTC target missed */}
            <div style={{
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: '10px',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>% of Daily RTC Missed</div>
              {(() => {
                const rtcDayMwh = summary.rtc_commitment_mw * 96 * 0.25;
                const pct = rtcDayMwh > 0 ? (shortfallEnergyMwh / rtcDayMwh) * 100 : 0;
                return (
                  <>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: pct > 5 ? '#ef4444' : '#fca5a5', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 }}>
                      {pct.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>% of {rtcDayMwh.toFixed(0)} MWh RTC target</div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          background: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.2)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: '#34d399',
        }}>
          <span>✓</span>
          <span><strong>Zero energy shortage</strong> — all 96 blocks met the compliance floor. No non-compliant deficit to report.</span>
        </div>
      )}
    </section>
  );
}
