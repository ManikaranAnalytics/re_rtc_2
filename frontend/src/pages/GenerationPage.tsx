import GenerationInputTable from '../components/generation/GenerationInputTable';

export default function GenerationPage() {
  return (
    <div className="generation-page">
      <div className="page-header-bar">
        <h2 className="page-heading">Generation Forecast Input</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Edit wind speed and solar generation per 15-minute block. Changes auto-sync to the optimizer.
        </p>
      </div>
      <GenerationInputTable />
    </div>
  );
}
