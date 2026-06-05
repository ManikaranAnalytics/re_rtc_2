import { useState } from 'react';
import { useOptimizer } from '../context/OptimizerContext';
import { AlertTriangle, CheckCircle2, Menu, X, PanelLeftClose, PanelLeftOpen, BatteryCharging, Eye } from 'lucide-react';

// Dashboard components
import KPICards from '../components/dashboard/KPICards';
import CarryForwardBar from '../components/dashboard/CarryForwardBar';
import DispatchChart from '../components/dashboard/DispatchChart';
import PSPTankGauge from '../components/dashboard/PSPTankGauge';
import SoCTimelineModal from '../components/dashboard/SoCTimelineModal';
import DispatchTable from '../components/dashboard/DispatchTable';
import PowerWastagePanel from '../components/dashboard/PowerWastagePanel';

// Config sidebar
import ConfigPanel from '../components/config/ConfigPanel';

export default function SingleDayPage() {
  const { scheduleData, loading, summary, error } = useOptimizer();

  // Mobile drawer
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Tank gauge visibility
  const [tankVisible, setTankVisible] = useState(true);

  // Full-page loader while initial fetch resolves
  if (!scheduleData && loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', borderRadius: '50%', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: '#00d2ff', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ color: '#94a3b8', fontSize: '16px' }}>Solving dispatch optimization models...</p>
      </div>
    );
  }

  return (
    <div className="single-day-page">

      {/* Page Header */}
      <div className="page-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Mobile sidebar toggle */}
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(prev => !prev)}
            aria-label="Toggle config"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <h2 className="page-heading">Single-Day Dispatch Schedule</h2>
        </div>

        {/* Right side: status + view toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {error && (
            <div className="status-badge status-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
          {summary && (
            <div className={`status-badge ${summary.fully_compliant ? 'status-ok' : 'status-warn'}`}>
              {summary.fully_compliant ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <span>{summary.fully_compliant ? 'FULLY COMPLIANT' : 'SHORTFALL WARNING'}</span>
            </div>
          )}

          {/* View toggle pills — compact, grouped */}
          <div className="view-toggles">
            <button
              className={`view-toggle-pill ${!sidebarCollapsed ? 'active' : ''}`}
              onClick={() => setSidebarCollapsed(prev => !prev)}
              title={sidebarCollapsed ? 'Show Config Panel' : 'Hide Config Panel'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <button
              className={`view-toggle-pill ${tankVisible ? 'active' : ''}`}
              onClick={() => setTankVisible(prev => !prev)}
              title={tankVisible ? 'Hide PSP Gauge' : 'Show PSP Gauge'}
            >
              {tankVisible ? <BatteryCharging size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards + Carry Bar + Power Wastage */}
      {summary && (
        <>
          <KPICards />
          <CarryForwardBar />
          <PowerWastagePanel />
        </>
      )}

      {/* Main 2-column layout */}
      <div className={`main-layout ${sidebarCollapsed ? 'sidebar-hidden' : ''}`}>

        {/* Sidebar overlay on mobile */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* Config Panel (sidebar) */}
        {!sidebarCollapsed && (
          <div className={`sidebar-wrapper ${sidebarOpen ? 'sidebar-open' : ''}`}>
            <ConfigPanel />
          </div>
        )}

        {/* Content area */}
        <div className="content-column">
          {/* Chart + Tank Gauge */}
          <div className={`visuals-container ${!tankVisible ? 'tank-hidden' : ''}`}>
            <DispatchChart />
            {tankVisible && <PSPTankGauge />}
          </div>

          {/* SoC Modal */}
          <SoCTimelineModal />

          {/* Dispatch Table */}
          <DispatchTable />
        </div>
      </div>
    </div>
  );
}
