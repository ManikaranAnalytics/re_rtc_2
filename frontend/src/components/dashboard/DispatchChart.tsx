import { Chart } from 'react-chartjs-2';
import '../../utils/chartSetup';
import { useOptimizer } from '../../context/OptimizerContext';

export default function DispatchChart() {
  const { blocks, rtcCommitment, loading } = useOptimizer();

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
        data: blocks.map(b => -b.psp_charge),
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
        label: 'Min 50% Compliance Floor (MW)',
        data: blocks.map(() => rtcCommitment * 0.50),
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
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(13, 20, 38, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 12,
        titleFont: { family: 'Outfit', size: 14, weight: 'bold' as const },
        bodyFont: { family: 'Outfit', size: 12 },
        callbacks: {
          label: function (context: any) {
            let label = context.dataset.label || '';
            let val = context.raw;
            if (val < 0) val = -val;
            return `  ${label}: ${val.toFixed(2)} MW`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 }, maxTicksLimit: 24 }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } },
        title: { display: true, text: 'Power Rate (MW)', color: '#94a3b8', font: { family: 'Outfit', size: 12, weight: 'bold' as const } }
      }
    }
  };

  return (
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
  );
}
