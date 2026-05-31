import MultiDayAnalysis from '../components/multiday/MultiDayAnalysis';

export default function MultiDayPage() {
  return (
    <div className="multiday-page-wrapper">
      <div className="page-header-bar">
        <h2 className="page-heading">Multi-Day Dispatch Analysis</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Sequential optimization with automatic SoC carry-forward across consecutive days.
        </p>
      </div>
      <MultiDayAnalysis />
    </div>
  );
}
