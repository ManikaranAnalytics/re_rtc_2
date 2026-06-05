import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import '../utils/chartSetup';
import { Settings2, Plus, Trash2 } from 'lucide-react';
import { useOptimizer } from '../context/OptimizerContext';
import type { CurtailmentSegment, PspDischargeSegment } from '../types';
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

/* ── Curtailment Line Chart — continuous single line ── */

function CurtailmentTimeline({ segments }: { segments: CurtailmentSegment[] }) {
  const blockNums = Array.from({ length: 96 }, (_, i) => i + 1);

  // Max partial cap for y-axis — uncurtailed sits at the top of the chart
  const maxPartialCap = segments.filter(s => s.maxMw > 0).reduce((m, s) => Math.max(m, s.maxMw), 0);
  const yMax = Math.max(maxPartialCap * 1.3, 50);

  // Helper: returns {value, color, fill} for each block
  const getInfo = (b: number) => {
    const seg = segments.find(s => s.startBlock <= b && b <= s.endBlock);
    if (!seg) return { value: yMax, border: 'rgba(22,101,52,0.9)',  bg: 'rgba(22,101,52,0.10)'  };
    if (seg.maxMw === 0) return { value: 0,    border: '#dc2626',              bg: 'rgba(220,38,38,0.13)'  };
    return            { value: seg.maxMw, border: '#d97706',              bg: 'rgba(217,119,6,0.13)'  };
  };

  const infos = useMemo(() => blockNums.map(b => getInfo(b)), [segments]);

  const labels = useMemo(() => blockNums.map(b => {
    const min = (b - 1) * 15;
    const hh  = String(Math.floor(min / 60)).padStart(2, '0');
    const mm  = String(min % 60).padStart(2, '0');
    return (b - 1) % 4 === 0 ? `${hh}:${mm}` : '';
  }), []);

  const chartData = useMemo(() => ({
    labels,
    datasets: [{
      label: 'MW Cap per Block',
      data: infos.map(i => i.value),
      // Per-point colours
      pointBackgroundColor: infos.map(i => i.border),
      pointBorderColor:     infos.map(i => i.border),
      pointRadius:          infos.map((_, idx) => {
        // show a dot at every transition boundary, hide mid-run points
        const prev = idx > 0 ? infos[idx - 1] : null;
        const next = idx < infos.length - 1 ? infos[idx + 1] : null;
        const changed = (prev && prev.border !== infos[idx].border) ||
                        (next && next.border !== infos[idx].border);
        return changed ? 4 : 0;
      }),
      pointHoverRadius: 5,
      borderWidth: 2.5,
      fill: true,
      tension: 0,
      spanGaps: true,
      // Chart.js v3 segment callbacks — colour each segment individually
      segment: {
        borderColor:     (ctx: any) => infos[ctx.p0DataIndex]?.border ?? '#94a3b8',
        backgroundColor: (ctx: any) => infos[ctx.p0DataIndex]?.bg    ?? 'transparent',
      },
    }],
  }), [infos, labels]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 } as const,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          generateLabels: () => [
            { text: 'Full curtailment (0 MW)', fillStyle: '#dc2626',             strokeStyle: '#dc2626',             lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
            { text: 'Partial cap (MW > 0)',    fillStyle: '#d97706',             strokeStyle: '#d97706',             lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
            { text: 'Uncurtailed',             fillStyle: 'rgba(22,101,52,0.7)', strokeStyle: 'rgba(22,101,52,0.9)', lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
          ],
          color: '#94a3b8',
          font: { family: 'Outfit', size: 11 },
          boxWidth: 12,
          padding: 14,
          usePointStyle: true,
        },
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(13,20,38,0.95)',
        titleColor: '#f8fafc',
        bodyColor:  '#e2e8f0',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items: any[]) => {
            const idx = items[0]?.dataIndex ?? 0;
            const b   = idx + 1;
            const min = idx * 15;
            const hh  = String(Math.floor(min / 60)).padStart(2, '0');
            const mm  = String(min % 60).padStart(2, '0');
            return `Block ${b}  —  ${hh}:${mm}`;
          },
          label: (item: any) => {
            const info = infos[item.dataIndex];
            if (!info) return '';
            if (info.border.startsWith('rgba(22,101')) return '  ✓ Uncurtailed (no cap)';
            if (item.raw === 0)                         return '  ✗ Full curtailment (0 MW)';
            return `  ⚡ Partial cap: ${item.raw} MW`;
          },
        },
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#64748b', font: { family: 'Outfit', size: 9 }, maxRotation: 0, autoSkip: false },
      },
      y: {
        min: 0,
        max: yMax,
        grid:  { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } },
        title: { display: true, text: 'MW Cap', color: '#64748b', font: { family: 'Outfit', size: 11 } },
      },
    },
  }), [infos, yMax]);

  return (
    <div style={{ height: '220px', position: 'relative' }}>
      <Line data={chartData as any} options={chartOptions as any} />
    </div>
  );
}

/* ── PSP Discharge Timeline Chart ── */

function PspDischargeTimeline({ segments, globalMax }: { segments: PspDischargeSegment[]; globalMax: number }) {
  const blockNums = Array.from({ length: 96 }, (_, i) => i + 1);
  const yMax = Math.max(globalMax * 1.3, 20);

  const getInfo = (b: number) => {
    const seg = segments.find(s => s.startBlock <= b && b <= s.endBlock);
    if (!seg) return { value: yMax,         border: 'rgba(22,101,52,0.9)',   bg: 'rgba(22,101,52,0.10)' };
    if (seg.maxDischargeMw === 0)
      return { value: 0,               border: '#7c3aed',                bg: 'rgba(124,58,237,0.16)' };
    return { value: seg.maxDischargeMw,  border: '#6366f1',                bg: 'rgba(99,102,241,0.14)' };
  };

  const infos = useMemo(() => blockNums.map(b => getInfo(b)), [segments, globalMax]);

  const labels = useMemo(() => blockNums.map(b => {
    const min = (b - 1) * 15;
    const hh  = String(Math.floor(min / 60)).padStart(2, '0');
    const mm  = String(min % 60).padStart(2, '0');
    return (b - 1) % 4 === 0 ? `${hh}:${mm}` : '';
  }), []);

  const chartData = useMemo(() => ({
    labels,
    datasets: [{
      label: 'PSP Discharge Cap per Block',
      data: infos.map(i => i.value),
      pointBackgroundColor: infos.map(i => i.border),
      pointBorderColor:     infos.map(i => i.border),
      pointRadius: infos.map((_, idx) => {
        const prev = idx > 0 ? infos[idx - 1] : null;
        const next = idx < infos.length - 1 ? infos[idx + 1] : null;
        const changed = (prev && prev.border !== infos[idx].border) ||
                        (next && next.border !== infos[idx].border);
        return changed ? 4 : 0;
      }),
      pointHoverRadius: 5,
      borderWidth: 2.5,
      fill: true,
      tension: 0,
      spanGaps: true,
      segment: {
        borderColor:     (ctx: any) => infos[ctx.p0DataIndex]?.border ?? '#94a3b8',
        backgroundColor: (ctx: any) => infos[ctx.p0DataIndex]?.bg    ?? 'transparent',
      },
    }],
  }), [infos, labels]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 } as const,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          generateLabels: () => [
            { text: 'Fully blocked (0 MW)',    fillStyle: '#7c3aed',             strokeStyle: '#7c3aed',             lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
            { text: 'Partial cap (MW > 0)',    fillStyle: '#6366f1',             strokeStyle: '#6366f1',             lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
            { text: 'Unrestricted',            fillStyle: 'rgba(22,101,52,0.7)', strokeStyle: 'rgba(22,101,52,0.9)', lineWidth: 2, pointStyle: 'rectRounded' as const, fontColor: '#94a3b8' },
          ],
          color: '#94a3b8',
          font: { family: 'Outfit', size: 11 },
          boxWidth: 12,
          padding: 14,
          usePointStyle: true,
        },
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: 'rgba(13,20,38,0.95)',
        titleColor: '#f8fafc',
        bodyColor:  '#e2e8f0',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items: any[]) => {
            const idx = items[0]?.dataIndex ?? 0;
            const b   = idx + 1;
            const min = idx * 15;
            const hh  = String(Math.floor(min / 60)).padStart(2, '0');
            const mm  = String(min % 60).padStart(2, '0');
            return `Block ${b}  —  ${hh}:${mm}`;
          },
          label: (item: any) => {
            const info = infos[item.dataIndex];
            if (!info) return '';
            if (info.border.startsWith('rgba(22,101')) return '  ✓ Unrestricted (global cap)';
            if (item.raw === 0)                         return '  ✗ Fully blocked (0 MW)';
            return `  ⚡ Capped at: ${item.raw} MW`;
          },
        },
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(255,255,255,0.03)' },
        ticks: { color: '#64748b', font: { family: 'Outfit', size: 9 }, maxRotation: 0, autoSkip: false },
      },
      y: {
        min: 0,
        max: yMax,
        grid:  { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } },
        title: { display: true, text: 'Discharge Cap (MW)', color: '#64748b', font: { family: 'Outfit', size: 11 } },
      },
    },
  }), [infos, yMax]);

  return (
    <div style={{ height: '220px', position: 'relative' }}>
      <Line data={chartData as any} options={chartOptions as any} />
    </div>
  );
}

/* ── PSP Discharge Segment Editor Table ── */

interface PspSegmentEditorProps {
  segments: PspDischargeSegment[];
  onChange: (segs: PspDischargeSegment[]) => void;
  overlappingIndices: Set<number>;
}

function PspSegmentEditor({ segments, onChange, overlappingIndices }: PspSegmentEditorProps) {
  const update = (i: number, patch: Partial<PspDischargeSegment>) => {
    const next = segments.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    onChange(next);
  };
  const remove = (i: number) => onChange(segments.filter((_, idx) => idx !== i));
  const add = () => onChange([...segments, { startBlock: 1, endBlock: 2, maxDischargeMw: 0 }]);

  const inputStyle = (invalid: boolean): React.CSSProperties => ({
    width: '100%',
    background: '#0a1020',
    border: `1px solid ${invalid ? 'rgba(239,68,68,0.6)' : 'rgba(139,92,246,0.3)'}`,
    borderRadius: '6px',
    color: invalid ? '#f87171' : '#a78bfa',
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
              {['Start Block', 'End Block', 'Time Range', 'Max Discharge MW (0 = blocked)', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, i) => {
              const isOverlap = overlappingIndices.has(i);
              const endInvalid = seg.endBlock <= seg.startBlock;
              const mwInvalid = seg.maxDischargeMw < 0;
              return (
                <tr key={i} style={{
                  background: isOverlap ? 'rgba(239,68,68,0.07)' : 'transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  transition: 'background 0.2s',
                }}>
                  <td style={{ padding: '6px 10px' }}>
                    <input type="number" min={1} max={96}
                      value={seg.startBlock}
                      onChange={e => update(i, { startBlock: parseInt(e.target.value) || 1 })}
                      style={inputStyle(isOverlap || endInvalid)} />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input type="number" min={1} max={96}
                      value={seg.endBlock}
                      onChange={e => update(i, { endBlock: parseInt(e.target.value) || 2 })}
                      style={inputStyle(isOverlap || endInvalid)} />
                  </td>
                  <td style={{ padding: '6px 10px', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    {blockToTime(seg.startBlock)} – {blockToTime(seg.endBlock)}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input type="number" min={0} step={0.5}
                      value={seg.maxDischargeMw}
                      onChange={e => update(i, { maxDischargeMw: parseFloat(e.target.value) || 0 })}
                      style={{ ...inputStyle(mwInvalid), color: seg.maxDischargeMw === 0 ? '#a78bfa' : '#818cf8' }} />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <button onClick={() => remove(i)} title="Remove segment"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={add}
        style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: '8px', color: '#a78bfa', fontSize: '13px', padding: '7px 14px', cursor: 'pointer', fontWeight: 600, transition: 'background 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.1)')}>
        <Plus size={14} /> Add Discharge Restriction
      </button>
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#475569' }}>Uncovered blocks use the global Max Injection (Discharge) limit above.</div>
    </div>
  );
}

/* ── PSP Discharge Stats ── */

function PspDischargeStats({ segments }: { segments: PspDischargeSegment[] }) {
  const blockedBlocks = segments.filter(s => s.maxDischargeMw === 0)
    .reduce((acc, s) => acc + (s.endBlock - s.startBlock + 1), 0);
  const cappedBlocks = segments.filter(s => s.maxDischargeMw > 0)
    .reduce((acc, s) => acc + (s.endBlock - s.startBlock + 1), 0);
  const cards = [
    { label: 'Fully Blocked Blocks', value: blockedBlocks.toString(), color: '#a78bfa', bg: 'rgba(139,92,246,0.08)' },
    { label: 'Partial Cap Blocks', value: cappedBlocks.toString(), color: '#818cf8', bg: 'rgba(99,102,241,0.08)' },
    { label: 'Unrestricted Blocks', value: (96 - blockedBlocks - cappedBlocks).toString(), color: '#34d399', bg: 'rgba(16,185,129,0.08)' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '4px' }}>
      {cards.map(c => (
        <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.color}30`, borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: c.color, fontFamily: 'var(--font-mono)' }}>{c.value}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{c.label}</div>
        </div>
      ))}
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
    carryFromDate, initialSocMwh,
    handleClearCarry,
    pspDischargeSegments, setPspDischargeSegments,
  } = useOptimizer();

  const errors = useMemo(() => validateSegments(curtailmentSegments), [curtailmentSegments]);
  const overlappingIndices = useMemo(() => detectOverlaps(curtailmentSegments), [curtailmentSegments]);
  const hasErrors = errors.length > 0;

  // PSP discharge segment validation
  const detectPspOverlaps = (segs: typeof pspDischargeSegments): Set<number> => {
    const overlapping = new Set<number>();
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].startBlock <= segs[j].endBlock && segs[j].startBlock <= segs[i].endBlock) {
          overlapping.add(i); overlapping.add(j);
        }
      }
    }
    return overlapping;
  };
  const pspOverlaps = useMemo(() => detectPspOverlaps(pspDischargeSegments), [pspDischargeSegments]);

  return (
    <div className="config-page">
      <div className="page-header-bar">
        <h2 className="page-heading">Advanced Configuration</h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
          Curtailment windows, PSP parameters, and carry-forward settings.
        </p>
      </div>

      {/* Single-column layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ─── PSP & Curtailment ─── */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings2 size={16} style={{ color: '#a5b4fc' }} />
            Plant &amp; Storage Parameters
          </h3>

          {/* ─── Curtailment + PSP Discharge side-by-side ─── */}

          {/* Row 1: Charts side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            {/* ── Generation Curtailment card ── */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Generation Curtailment</span>
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
                <>
                  {hasErrors && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px' }}>
                      {errors.map((e, i) => (
                        <div key={i} style={{ color: '#f87171', marginBottom: i < errors.length - 1 ? '4px' : 0 }}>⚠ {e}</div>
                      ))}
                    </div>
                  )}
                  <CurtailmentTimeline segments={curtailmentSegments} />
                  <SegmentEditor
                    segments={curtailmentSegments}
                    onChange={segs => setCurtailmentSegments(segs)}
                    overlappingIndices={overlappingIndices}
                  />
                  <CurtailmentStats segments={curtailmentSegments} />
                </>
              ) : (
                <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
                  No curtailment — full generation all 96 blocks
                </div>
              )}
            </div>

            {/* ── PSP Discharge Curtailment card ── */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: '700', color: '#a78bfa', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔋 PSP Discharge Curtailment</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {pspDischargeSegments.length === 0 ? 'No restrictions' : `${pspDischargeSegments.length} segment(s)`}
                </span>
              </div>

              {pspOverlaps.size > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#f87171' }}>
                  ⚠ Discharge segments overlap — fix highlighted rows
                </div>
              )}

              <PspDischargeTimeline segments={pspDischargeSegments} globalMax={maxDischargeMw} />

              <PspSegmentEditor
                segments={pspDischargeSegments}
                onChange={segs => setPspDischargeSegments(segs)}
                overlappingIndices={pspOverlaps}
              />

              <PspDischargeStats segments={pspDischargeSegments} />

              <div style={{ fontSize: '11px', color: '#475569', lineHeight: '1.6' }}>
                Restricting discharge forces the optimizer to rely on direct generation only for those windows.
              </div>
            </div>

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
              <li>Min delivery floor: 50% of RTC commitment.</li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
