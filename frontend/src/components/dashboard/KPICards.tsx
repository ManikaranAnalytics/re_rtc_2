import { Zap, CheckCircle2, BatteryCharging, TrendingUp } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';

export default function KPICards() {
  const { summary } = useOptimizer();
  if (!summary) return null;

  return (
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
        <span className="kpi-subtitle">Compliance threshold: {(summary.rtc_commitment_mw * 0.50).toFixed(1)} MW (50%)</span>
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
        <span className="kpi-subtitle">Charged: {summary.total_charged_mwh.toFixed(1)} MWh (usable: {(summary.psp_usable_charged_mwh ?? summary.total_charged_mwh * 0.8).toFixed(1)} MWh) | EOD SoC: {summary.end_soc_mwh.toFixed(1)} MWh</span>
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
  );
}
