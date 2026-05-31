import { Chart } from 'react-chartjs-2';
import '../../utils/chartSetup';
import { useOptimizer } from '../../context/OptimizerContext';

export default function SoCTimelineModal() {
  const { socModalOpen, setSocModalOpen, blocks, selectedDate, maxSocMwh } = useOptimizer();

  if (!socModalOpen || blocks.length === 0) return null;

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
  );
}
