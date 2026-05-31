import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';

export default function Header() {
  const { error, summary } = useOptimizer();

  return (
    <header className="dashboard-header">

      {/* LEFT — Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '0 0 auto' }}>
        <img
          src="/logo.png"
          alt="Manikaran Analytics Logo"
          style={{
            height: '56px',
            width: 'auto',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* CENTER — Title (truly centered via flex:1 + text-align:center) */}
      <div className="header-title-area" style={{ flex: 1, textAlign: 'center' }}>
        <h1>RE-RTC DISPATCH OPTIMIZER</h1>
      </div>

      {/* RIGHT — Status badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto', justifyContent: 'flex-end' }}>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171', fontSize: '13px' }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {summary && (
          <div className={`badge-compliance ${summary.fully_compliant ? 'compliant' : 'shortfall'}`}>
            {summary.fully_compliant ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{summary.fully_compliant ? 'FULLY COMPLIANT' : 'SHORTFALL WARNING'}</span>
          </div>
        )}
      </div>
    </header>
  );
}
