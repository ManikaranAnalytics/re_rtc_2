import { NavLink } from 'react-router-dom';
import { Zap, BarChart3, Wind, Settings2 } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Single-Day Dispatch', icon: Zap },
  { to: '/multi-day', label: 'Multi-Day Analysis', icon: BarChart3 },
  { to: '/generation', label: 'Generation Input', icon: Wind },
];

export default function Navigation() {
  return (
    <nav className="top-nav">
      <div className="top-nav-inner">
        {/* Logo */}
        <div className="nav-brand">
          <img src="/logo.png" alt="Manikaran Analytics" className="nav-logo" />
          <div className="nav-brand-text">
            <span className="nav-title">RE-RTC DISPATCH OPTIMIZER</span>
          </div>
        </div>

        {/* Route Tabs */}
        <div className="nav-tabs">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-tab ${isActive ? 'nav-tab-active' : ''}`}
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}

          {/* Config button — distinct style beside Generation Input */}
          <NavLink
            to="/config"
            className={({ isActive }) => `nav-config-btn ${isActive ? 'nav-config-btn-active' : ''}`}
            title="Configuration"
          >
            <Settings2 size={16} />
            <span>Config</span>
          </NavLink>
        </div>

        {/* Spacer */}
        <div className="nav-right" />
      </div>
    </nav>
  );
}
