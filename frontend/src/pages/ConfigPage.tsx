import React, { useMemo } from 'react';
import { Settings2, Table2, Plus, Trash2 } from 'lucide-react';
import { useOptimizer } from '../context/OptimizerContext';
import type { CurtailmentSegment } from '../types';
import {
  PSP_MAX_CAPACITY_MWH,
  PSP_SLIDER_MAX_CHARGE_MW,
  PSP_SLIDER_MAX_DISCHARGE_MW,
  PSP_SLIDER_MAX_MIN_DISPATCH_MW,
} from '../utils/constants';

/* ── helpers ── */

function blockToTime(block: number): string {
  const totalMin = (block - 1) * 15;
  const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
  const mm = (totalMin % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function segmentColor(maxMw: number): string {
  if (maxMw === 0) return '#dc2626';   // full curtail — dark red
  return '#d97706';                     // partial curtail — amber
}

function detectOverlaps(segments: CurtailmentSegment[]): Set<number> {
  const overlapping = new Set<number>();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[i].startBlock <= segments[j].endBlock &&
          segments[j].startBlock <= segments[i].endBlock) {
        overlapping.add(i);
        overlapping.add(j);
      }
    }
  }
  return overlapping;
}

function validateSegments(segments: CurtailmentSegment[]): string[] {
  const errors: string[] = [];
  const overlaps = detectOverlaps(segments);
  if (overlaps.size > 0) errors.push('Segments overlap — fix highlighted rows before saving.');
  segments.forEach((s, i) => {
    if (s.endBlock <= s.startBlock) errors.push(`Segment ${i + 1}: End Block must be > Start Block.`);
    if (s.maxMw < 0) errors.push(`Segment ${i + 1}: Max MW must be ≥ 0.`);
  });
  return errors;
}

/* ── Curtailment Timeline Bar ── */

function CurtailmentTimeline({ segments }: { segments: CurtailmentSegment[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  const blockColors = useMemo(() => {
    const colors: Record<number, string> = {};
    for (let b = 1; b <= 96; b++) {
      const seg = segments.find(s => s.startBlock <= b && b <= s.endBlock);
      if (!seg) colors[b] = '#166534';           // green — uncurtailed
      else colors[b] = segmentColor(seg.maxMw);
    }
    return colors;
  }, [segments]);

  const hoveredSeg = hovered !== null
    ? segments.find(s => s.startBlock <= hovered && hovered <= s.endBlock)
    : null;

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* Block strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(96, 1fr)',
          height: '40px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          cursor: 'crosshair',
        }}
      >
        {Array.from({ length: 96 }, (_, i) => i + 1).map(b => (
          <div
            key={b}
            onMouseEnter={e => { setHovered(b); setTooltipPos({ x: e.clientX, y: e.clientY }); }}
            onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: blockColors[b],
              opacity: hovered === b ? 0.75 : 1,
              transition: 'opacity 0.1s',
            }}
          />
        ))}
      </div>

      {/* Time labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map(t => (
          <span key={t}>{t}</span>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#dc2626', display: 'inline-block' }} />
          Full curtailment (MW = 0)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#d97706', display: 'inline-block' }} />
          Partial cap (MW &gt; 0)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: '#166534', display: 'inline-block' }} />
          Uncurtailed
        </span>
      </div>

      {/* Tooltip */}
      {hovered !== null && (
        <div style={{
          position: 'fixed',
          left: tooltipPos.x + 12,
          top: tooltipPos.y - 36,
          background: 'rgba(15,23,42,0.95)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '12px',
          color: '#e2e8f0',
          pointerEvents: 'none',
          zIndex: 9999,
          whiteSpace: 'nowrap',
        }}>
          <strong>Block {hovered}</strong> — {blockToTime(hovered)}&nbsp;|&nbsp;
          {hoveredSeg
            ? hoveredSeg.maxMw === 0
              ? <span style={{ color: '#f87171' }}>Full curtailment</span>
              : <span style={{ color: '#fbbf24' }}>MW cap: {hoveredSeg.maxMw}</span>
            : <span style={{ color: '#4ade80' }}>Uncurtailed</span>
          }
        </div>
      )}
    </div>
  );
}

/* ── Segment Editor Table ── */

interface SegmentEditorProps {
  segments: CurtailmentSegment[];
  onChange: (segs: CurtailmentSegment[]) => void;
  overlappingIndices: Set<number>;
}

function SegmentEditor({ segments, onChange, overlappingIndices }: SegmentEditorProps) {
  const update = (i: number, patch: Partial<CurtailmentSegment>) => {
    const next = segments.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    onChange(next);
  };
  const remove = (i: number) => onChange(segments.filter((_, idx) => idx !== i));
  const add = () => onChange([...segments, { startBlock: 1, endBlock: 2, maxMw: 0 }]);

  const inputStyle = (invalid: boolean): React.CSSProperties => ({
    width: '100%',
    background: '#0a1020',
    border: `1px solid ${invalid ? 'rgba(239,68,68,0.6)' : 'rgba(251,191,36,0.25)'}`,
    borderRadius: '6px',
    color: invalid ? '#f87171' : '#fbbf24',
    padding: '7px 8px',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
  });

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Start Block', 'End Block', 'Time Range', 'Max MW (0 = full)', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, i) => {
              const isOverlap = overlappingIndices.has(i);
              const endInvalid = seg.endBlock <= seg.startBlock;
              const mwInvalid = seg.maxMw < 0;
              return (
                <tr key={i} style={{
                  background: isOverlap ? 'rgba(239,68,68,0.07)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  transition: 'background 0.2s',
                }}>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="number" min={1} max={96}
                      value={seg.startBlock}
                      onChange={e => update(i, { startBlock: parseInt(e.target.value) || 1 })}
                      style={inputStyle(isOverlap || endInvalid)}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="number" min={1} max={96}
                      value={seg.endBlock}
                      onChange={e => update(i, { endBlock: parseInt(e.target.value) || 2 })}
                      style={inputStyle(isOverlap || endInvalid)}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    {blockToTime(seg.startBlock)} – {blockToTime(seg.endBlock)}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="number" min={0} step={0.5}
                      value={seg.maxMw}
                      onChange={e => update(i, { maxMw: parseFloat(e.target.value) || 0 })}
                      style={{
                        ...inputStyle(mwInvalid),
                        color: seg.maxMw === 0 ? '#f87171' : '#fbbf24',
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <button
                      onClick={() => remove(i)}
                      title="Remove segment"
                      style={{
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '6px', color: '#f87171', padding: '5px 8px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        onClick={add}
        style={{
          marginTop: '10px',
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
          borderRadius: '8px', color: '#fbbf24', fontSize: '13px', padding: '7px 14px',
          cursor: 'pointer', fontWeight: 600, transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.16)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.08)')}
      >
        <Plus size={14} /> Add Segment
      </button>
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#475569' }}>
        Uncovered blocks treated as no curtailment
      </div>
    </div>
  );
}

/* ── Summary Stat Cards ── */

function CurtailmentStats({ segments }: { segments: CurtailmentSegment[] }) {
  const fullBlocks = segments
    .filter(s => s.maxMw === 0)
    .reduce((acc, s) => acc + (s.endBlock - s.startBlock + 1), 0);
  const partialBlocks = segments
    .filter(s => s.maxMw > 0)
    .reduce((acc, s) => acc + (s.endBlock - s.startBlock + 1), 0);
  // Rough estimate: full curtailment loss ~assumes average 10MW generation
  const estimatedLoss = (fullBlocks * 10 * 0.25).toFixed(0);

  const cards = [
    { label: 'Fully Curtailed Blocks', value: fullBlocks.toString(), color: '#f87171', bg: 'rgba(239,68,68,0.08)' },
    { label: 'Est. Generation Lost', value: `~${estimatedLoss} MWh`, color: '#fb923c', bg: 'rgba(251,146,60,0.08)', sub: 'full curtailment only' },
    { label: 'Partial Curtailment Blocks', value: partialBlocks.toString(), color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: c.bg, border: `1px solid ${c.color}30`,
          borderRadius: '10px', padding: '12px 14px',
        }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: c.color, fontFamily: 'var(--font-mono)' }}>{c.value}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{c.label}</div>
          {c.sub && <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── ConfigPage ── */

export default function ConfigPage() {
  const {
    maxSocMwh, setMaxSocMwh,
    maxChargeMw, setMaxChargeMw,
    maxDischargeMw, setMaxDischargeMw,
    minDispatchMw, setMinDispatchMw,
    curtailmentEnabled, setCurtailmentEnabled,
    curtailmentSegments, setCurtailmentSegments,
    roundtripLoss, setRoundtripLoss,
    sideTab, setSideTab,
    blockOverrides, setBlockOverrides,
    blocks,
    carryFromDate, initialSocMwh,
    handleClearCarry,
  } = useOptimizer();

  const errors = useMemo(() => validateSegments(curtailmentSegments), [curtailmentSegments]);
  const overlappingIndices = useMemo(() => detectOverlaps(curtailmentSegments), [curtailmentSegments]);
  const hasErrors = errors.length > 0;

  return (
    <div className="config-page">
      <div className="page-header-bar">
        <h2 className="page-heading">Advanced Configuration</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Curtailment windows, PSP parameters, block-level overrides, and carry-forward settings.
        </p>
      </div>

      {/* Two-column card layout */}
      <div className="config-page-grid">

        {/* ─── Left Column: PSP & Curtailment ─── */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings2 size={16} style={{ color: '#a5b4fc' }} />
            Plant &amp; Storage Parameters
          </h3>

          {/* ─── Curtailment Segment Config ─── */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '10px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Curtailment Segments</span>
              <button
                onClick={() => setCurtailmentEnabled(p => !p)}
                style={{
                  background: curtailmentEnabled ? 'rgba(251,191,36,0.2)' : 'rgba(100,116,139,0.15)',
                  border: `1px solid ${curtailmentEnabled ? 'rgba(251,191,36,0.5)' : 'rgba(100,116,139,0.3)'}`,
                  borderRadius: '20px', color: curtailmentEnabled ? '#fbbf24' : '#64748b',
                  fontSize: '11px', padding: '4px 12px', cursor: 'pointer', fontWeight: '700',
                }}
              >
                {curtailmentEnabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>

            {curtailmentEnabled ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Validation errors */}
                {hasErrors && (
                  <div style={{
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '8px', padding: '10px 12px', fontSize: '12px',
                  }}>
                    {errors.map((e, i) => (
                      <div key={i} style={{ color: '#f87171', marginBottom: i < errors.length - 1 ? '4px' : 0 }}>⚠ {e}</div>
                    ))}
                  </div>
                )}

                {/* Visual timeline */}
                <CurtailmentTimeline segments={curtailmentSegments} />

                {/* Segment table editor */}
                <SegmentEditor
                  segments={curtailmentSegments}
                  onChange={segs => setCurtailmentSegments(segs)}
                  overlappingIndices={overlappingIndices}
                />

                {/* Summary stats */}
                <CurtailmentStats segments={curtailmentSegments} />
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
                No curtailment — full generation all 96 blocks
              </div>
            )}
          </div>

          {/* PSP Round-Trip Loss */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">PSP Round-Trip Loss</span>
              <span className="config-value" style={{ color: '#f87171' }}>{roundtripLoss.toFixed(0)}%</span>
            </div>
            <input type="range" min="10" max="30" step="1" className="range-slider" value={roundtripLoss} onChange={e => setRoundtripLoss(parseFloat(e.target.value))} style={{ '--color-wind': '#f87171' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>10% (optimistic)</span>
              <span>Usable per MWh stored: {(100 - roundtripLoss).toFixed(0)}%</span>
            </div>
          </div>

          {/* PSP Max Capacity */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">PSP Max Capacity</span>
              <span className="config-value" style={{ color: '#a78bfa' }}>{maxSocMwh.toFixed(0)} MWh</span>
            </div>
            <input type="range" min="10" max={PSP_MAX_CAPACITY_MWH} step="5" className="range-slider" value={maxSocMwh} onChange={e => setMaxSocMwh(parseFloat(e.target.value))} style={{ '--color-wind': '#a78bfa' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>10 MWh (min)</span>
              <span style={{ color: maxSocMwh === PSP_MAX_CAPACITY_MWH ? '#64748b' : '#f59e0b' }}>
                {maxSocMwh < PSP_MAX_CAPACITY_MWH
                  ? `${(PSP_MAX_CAPACITY_MWH - maxSocMwh).toFixed(0)} MWh below max`
                  : `Full ${PSP_MAX_CAPACITY_MWH} MWh`}
              </span>
            </div>
          </div>

          {/* Max Drawal (Charge) */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Max Drawal (Charge)</span>
              <span className="config-value" style={{ color: '#38bdf8' }}>{maxChargeMw.toFixed(0)} MW</span>
            </div>
            <input type="range" min="0" max={PSP_SLIDER_MAX_CHARGE_MW} step="1" className="range-slider" value={maxChargeMw} onChange={e => setMaxChargeMw(parseFloat(e.target.value))} style={{ '--color-wind': '#38bdf8' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>0 MW</span>
              <span>Grid → PSP charging limit</span>
            </div>
          </div>

          {/* Max Injection (Discharge) */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Max Injection (Discharge)</span>
              <span className="config-value" style={{ color: '#34d399' }}>{maxDischargeMw.toFixed(0)} MW</span>
            </div>
            <input type="range" min="0" max={PSP_SLIDER_MAX_DISCHARGE_MW} step="1" className="range-slider" value={maxDischargeMw} onChange={e => setMaxDischargeMw(parseFloat(e.target.value))} style={{ '--color-wind': '#34d399' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>0 MW</span>
              <span>PSP → grid discharge limit</span>
            </div>
          </div>

          {/* Min Dispatch (CERC) */}
          <div className="config-group">
            <div className="config-label-area">
              <span className="config-label">Min Dispatch (CERC)</span>
              <span className="config-value" style={{ color: '#fbbf24' }}>{minDispatchMw.toFixed(0)} MW</span>
            </div>
            <input type="range" min="0" max={PSP_SLIDER_MAX_MIN_DISPATCH_MW} step="1" className="range-slider" value={minDispatchMw} onChange={e => setMinDispatchMw(parseFloat(e.target.value))} style={{ '--color-wind': '#fbbf24' } as React.CSSProperties} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>0 MW (off)</span>
              <span>Min charge/discharge when PSP runs</span>
            </div>
          </div>

          {/* SoC Carry-Forward info */}
          <div style={{
            background: carryFromDate ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${carryFromDate ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: '10px',
            padding: '16px'
          }}>
            <div style={{ fontWeight: '700', color: carryFromDate ? '#34d399' : '#64748b', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>⚡ SoC Carry-Forward</div>
            {carryFromDate ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>Carrying from <span style={{ color: '#34d399', fontWeight: '600' }}>{carryFromDate}</span></div>
                <div style={{ fontSize: '14px', color: '#e2e8f0' }}>Starting SoC: <span style={{ color: '#34d399', fontWeight: '700' }}>{initialSocMwh.toFixed(1)} MWh</span></div>
                <button onClick={handleClearCarry} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '12px', padding: '6px 14px', cursor: 'pointer', fontWeight: '600', alignSelf: 'flex-start' }}>✕ Clear — Start Fresh</button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.6' }}>Each day starts fresh at SoC = 0 MWh.<br />Use <strong style={{ color: '#94a3b8' }}>Roll to Next Day →</strong> on the dispatch page to carry SoC.</div>
            )}
          </div>

          {/* Regulatory Constraints */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <span style={{ fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px', fontSize: '14px' }}>Regulatory Constraints:</span>
            <ul style={{ paddingLeft: '18px', margin: 0 }}>
              <li style={{ marginBottom: '6px' }}>
                Curtailment: {curtailmentEnabled
                  ? curtailmentSegments.length === 0
                    ? 'Enabled (no segments defined)'
                    : `${curtailmentSegments.length} segment(s) active`
                  : 'Disabled this season'}.
              </li>
              <li style={{ marginBottom: '6px' }}>Orvakallu PSP storage capacity configurable up to {PSP_MAX_CAPACITY_MWH} MWh.</li>
              <li style={{ marginBottom: '6px' }}>PSP rates: charge ≤ {maxChargeMw} MW, discharge ≤ {maxDischargeMw} MW, min dispatch {minDispatchMw} MW.</li>
              <li>Min delivery floor: 75% of RTC commitment.</li>
            </ul>
          </div>
        </div>

        {/* ─── Right Column: Block-Level Data Overrides ─── */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Table2 size={16} style={{ color: '#fbbf24' }} />
              Block-Level Overrides
            </h3>
            {Object.keys(blockOverrides).length > 0 && (
              <button onClick={() => setBlockOverrides({})} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '12px', padding: '5px 12px', cursor: 'pointer', fontWeight: '600' }}>Clear All ({Object.keys(blockOverrides).length})</button>
            )}
          </div>

          <div style={{ fontSize: '12px', color: '#64748b', padding: '8px 12px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '8px' }}>
            Override Wind/Solar MW per block — leave blank to use forecast values. Changes auto-sync to the optimizer.
          </div>

          <div className="table-container" style={{ maxHeight: '520px' }}>
            <table className="schedule-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '70px' }}>Block</th>
                  <th style={{ color: '#00b4d8' }}>Wind MW Override</th>
                  <th style={{ color: '#f59e0b' }}>Solar MW Override</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map(b => (
                  <tr key={b.block} style={{ background: b.curtail_flag ? 'rgba(51,65,85,0.3)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ color: '#64748b', fontWeight: '700', fontFamily: 'var(--font-mono)' }}>
                      {b.block} <span style={{ fontSize: '10px', color: '#475569' }}>{b.time.substring(0, 5)}</span>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        placeholder={b.wind_mw.toFixed(2)}
                        value={blockOverrides[b.block]?.wind_mw ?? ''}
                        onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, wind_mw: e.target.value } }))}
                        style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(0,180,216,0.2)', borderRadius: '6px', color: '#00d2ff', padding: '6px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        placeholder={b.solar_mw.toFixed(2)}
                        value={blockOverrides[b.block]?.solar_mw ?? ''}
                        onChange={e => setBlockOverrides(prev => ({ ...prev, [b.block]: { ...prev[b.block] ?? { wind_mw: '', solar_mw: '' }, solar_mw: e.target.value } }))}
                        style={{ width: '100%', background: '#0a1020', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '6px', color: '#f59e0b', padding: '6px 8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
