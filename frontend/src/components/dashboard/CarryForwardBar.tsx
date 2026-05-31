import { useOptimizer } from '../../context/OptimizerContext';
import { JUNE_DATES } from '../../utils/constants';

export default function CarryForwardBar() {
  const {
    summary, scheduleData, carryFromDate, initialSocMwh,
    roundtripLoss, selectedDate, handleRollToNextDay, handleClearCarry,
  } = useOptimizer();

  if (!summary) return null;

  return (
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
  );
}
