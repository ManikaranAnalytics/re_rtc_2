import { Outlet } from 'react-router-dom';
import Navigation from './Navigation';
import Footer from './Footer';

export default function AppLayout() {
  return (
    <div className="app-shell">
      <Navigation />
      <div className="page-content">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
