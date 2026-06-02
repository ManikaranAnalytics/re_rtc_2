import { useOptimizer } from '../../context/OptimizerContext';

export default function PSPTankGauge() {
  const {
    summary, maxSocMwh, maxChargeMw, maxDischargeMw, minDispatchMw,
    roundtripLoss, blocks, setSocModalOpen,
  } = useOptimizer();

  const endSocMwh = summary?.end_soc_mwh || 0.0;
  const socPercentage = Math.min(((endSocMwh / maxSocMwh) * 100), 100).toFixed(1);

  return (
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
          <span style={{ color: 'var(--text-primary)' }}>{maxSocMwh} MWh</span>
        </div>
        <div className="psp-metric-row">
          <span>Max Drawal (Charge)</span>
          <span>{maxChargeMw} MW</span>
        </div>
        <div className="psp-metric-row">
          <span>Max Injection (Disch.)</span>
          <span>{maxDischargeMw} MW</span>
        </div>
        <div className="psp-metric-row">
          <span>Min Dispatch</span>
          <span style={{ color: '#fbbf24' }}>{minDispatchMw} MW (CERC)</span>
        </div>
        <div className="psp-metric-row">
          <span>Avg Roundtrip Loss</span>
          <span>{roundtripLoss.toFixed(0)}% ({(1 / (1 - roundtripLoss / 100)).toFixed(2)}x)</span>
        </div>
      </div>
    </section>
  );
}
