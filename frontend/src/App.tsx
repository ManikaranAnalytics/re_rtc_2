import './utils/chartSetup';
import { Routes, Route } from 'react-router-dom';
import { OptimizerProvider } from './context/OptimizerContext';

// Layout
import AppLayout from './components/layout/AppLayout';

// Pages
import SingleDayPage from './pages/SingleDayPage';
import MultiDayPage from './pages/MultiDayPage';
import GenerationPage from './pages/GenerationPage';
import ConfigPage from './pages/ConfigPage';

export default function App() {
  return (
    <OptimizerProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<SingleDayPage />} />
          <Route path="multi-day" element={<MultiDayPage />} />
          <Route path="generation" element={<GenerationPage />} />
          <Route path="config" element={<ConfigPage />} />
        </Route>
      </Routes>
    </OptimizerProvider>
  );
}
