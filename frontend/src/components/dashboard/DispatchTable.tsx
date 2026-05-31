import { useState, useRef } from 'react';
import { Download } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';
import { BASE_URL } from '../../utils/constants';

export default function DispatchTable() {
  const {
    blocks, rtcCommitment, scheduleData,
    selectedDate, wtgCount, solarAc,
    curtailmentEnabled, curtailmentStart, curtailmentEnd,
    roundtripLoss, maxSocMwh,
  } = useOptimizer();

  const [excelLoading, setExcelLoading] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const handleExcelDownload = async () => {
    setExcelLoading(true);
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        wtg_count: String(wtgCount),
        solar_ac_mw: String(solarAc),
        rtc_commitment_mw: String(rtcCommitment),
        curtailment_enabled: String(curtailmentEnabled),
        curtailment_start_block: String(curtailmentStart),
        curtailment_end_block: String(curtailmentEnd),
        roundtrip_loss_pct: String(roundtripLoss),
        min_compliance_ratio: '0.75',
        max_soc_mwh: String(maxSocMwh),
        min_dispatch_mw: '6',
      });
      const response = await fetch(`${BASE_URL}/api/export/excel?${params.toString()}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RTC_Dispatch_${selectedDate}_WTG${wtgCount}_Solar${solarAc}MW.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel download failed:', err);
      alert('Excel export failed. Please ensure the backend server is running.');
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <section className="glass-panel table-panel">
      <div className="table-header-wrapper">
        <h2 className="table-title">Interval-Wise Energy Accounts (15-min)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', flexWrap: 'wrap' }}>
          <span className="cell-badge curtail">Wind + Solar Curtailment Active (B37–64)</span>
          <span className="cell-badge warn" style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#ef4444' }}>Compliance Shortfall</span>
          <button
            id="btn-download-excel"
            onClick={handleExcelDownload}
            disabled={excelLoading || !scheduleData}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: excelLoading
                ? 'rgba(16,185,129,0.05)'
                : 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(5,150,105,0.12) 100%)',
              border: '1px solid rgba(16,185,129,0.35)',
              borderRadius: '8px',
              color: '#34d399',
              fontSize: '12px',
              fontWeight: '600',
              cursor: excelLoading || !scheduleData ? 'not-allowed' : 'pointer',
              opacity: excelLoading || !scheduleData ? 0.6 : 1,
              transition: 'all 0.2s ease',
              letterSpacing: '0.3px',
              whiteSpace: 'nowrap',
              fontFamily: 'Outfit, sans-serif'
            }}
            onMouseEnter={e => {
              if (!excelLoading && scheduleData) {
                (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(16,185,129,0.28) 0%, rgba(5,150,105,0.22) 100%)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,0.6)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(16,185,129,0.25)';
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(5,150,105,0.12) 100%)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(16,185,129,0.35)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
            }}
          >
            {excelLoading ? (
              <>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid rgba(52,211,153,0.2)', borderTopColor: '#34d399', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                Generating...
              </>
            ) : (
              <>
                <Download size={13} />
                Download Excel
              </>
            )}
          </button>
        </div>
      </div>

      <div className="table-container" ref={tableRef}>
        <table className="schedule-table">
          <thead>
            <tr>
              <th>TB</th>
              <th>Time</th>
              <th>Wind MW</th>
              <th>Solar MW</th>
              <th>Combined Generation</th>
              <th>PSP Action</th>
              <th>SoC end</th>
              <th>Net Schedule</th>
              <th>Target Floor</th>
              <th style={{ color: 'var(--color-rtm)' }}>RTM MW</th>
              <th style={{ color: '#34d399', fontSize: '11px' }}>Carry Budget</th>
              <th style={{ color: '#34d399', fontSize: '11px' }}>Carry Disch.</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
              let pspBadge = <span className="psp-action-badge idle">Idle</span>;
              if (b.psp_charge > 0) {
                pspBadge = <span className="psp-action-badge charge">▲ Charge: {b.psp_charge.toFixed(1)}</span>;
              } else if (b.psp_discharge > 0) {
                pspBadge = <span className="psp-action-badge discharge">▼ Disch: {b.psp_discharge.toFixed(1)}</span>;
              }

              const isCurtailed = b.curtail_flag;
              const isShortfall = !b.compliant;

              let rowClass = "";
              if (isShortfall) rowClass = "shortfall-row";
              else if (isCurtailed) rowClass = "curtailed-row";

              return (
                <tr key={b.block} className={rowClass}>
                  <td className="mono-col">{b.block}</td>
                  <td className="mono-col">{b.time.substring(0, 5)}</td>
                  <td className="mono-col">
                    {isCurtailed ? (
                      <span style={{ color: 'var(--color-wind)', fontWeight: '600' }}>0.00 ✂</span>
                    ) : (
                      b.wind_mw.toFixed(2)
                    )}
                  </td>
                  <td className="mono-col">
                    {isCurtailed ? (
                      <span style={{ color: 'var(--color-solar)', fontWeight: '600' }}>0.00 ✂</span>
                    ) : (
                      b.solar_mw.toFixed(2)
                    )}
                  </td>
                  <td className="mono-col">{(b.wind_mw + b.solar_mw).toFixed(2)}</td>
                  <td>{pspBadge}</td>
                  <td className="mono-col">{b.soc_end.toFixed(1)} MWh</td>
                  <td className="mono-col" style={{ color: isShortfall ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                    {Math.min(b.net_schedule, rtcCommitment).toFixed(2)}
                  </td>
                  <td className="mono-col">{b.min_schedule.toFixed(2)}</td>
                  <td className="mono-col" style={{ color: b.rtm_surplus > 0 ? 'var(--color-rtm)' : 'var(--text-muted)' }}>
                    {b.rtm_surplus.toFixed(2)}
                  </td>
                  <td className="mono-col" style={{ color: b.carry_budget_mwh > 0 ? '#34d399' : 'var(--text-muted)', fontSize: '12px' }}>
                    {b.carry_budget_mwh > 0 ? b.carry_budget_mwh.toFixed(2) : '—'}
                  </td>
                  <td className="mono-col" style={{ color: b.carry_discharge_mw > 0 ? '#6ee7b7' : 'var(--text-muted)', fontSize: '12px' }}>
                    {b.carry_discharge_mw > 0 ? b.carry_discharge_mw.toFixed(2) : '—'}
                  </td>
                  <td>
                    <span className={`cell-badge ${isShortfall ? 'warn' : 'ok'}`}>
                      {isShortfall ? 'Shortfall' : 'Compliant'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
