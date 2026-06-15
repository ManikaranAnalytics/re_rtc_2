import React, { useRef, useState } from 'react';
import { Calendar, Download, Upload } from 'lucide-react';
import { useOptimizer } from '../../context/OptimizerContext';
import { BASE_URL } from '../../utils/constants';
import { lookupWindMW } from '../../utils/powerCurve';
import {
  buildMultiDayGenerationTemplate,
  downloadTextFile,
  parseGenerationUpload,
} from '../../utils/parseGenerationUpload';
import type { GenEdit, RawForecastRow } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSimulationDate(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Returns all ISO date strings in [from, to] inclusive. */
function getDatesInRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const dates: string[] = [];
  const current = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (current <= end) {
    // Use local date parts (not toISOString) to avoid UTC offset shifting the date
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GenerationInputTable() {
  const {
    rawForecast,
    genTableEdits,
    setGenTableEdits,
    multiDayGenEdits,
    setMultiDayGenEdits,
    wtgCount,
    solarAc,
    selectedDate,
    setSelectedDate,
  } = useOptimizer();

  // Date range for template download / bulk upload — fromDate drives the visible table
  const [fromDate, setFromDate] = useState(selectedDate || '2026-06-01');
  const [toDate, setToDate] = useState('2026-06-07');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const genTableRef = useRef<HTMLDivElement>(null);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);

  if (rawForecast.length === 0) return null;

  const modifiedCount = Object.keys(genTableEdits).length;
  const datesInRange = getDatesInRange(fromDate, toDate);

  const cellInputStyle = (color: string, modified: boolean): React.CSSProperties => ({
    width: '100%',
    background: modified ? 'rgba(245,158,11,0.08)' : '#0a1020',
    border: `1px solid ${modified ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.07)'}`,
    borderRadius: '5px',
    color: modified ? '#fbbf24' : color,
    padding: '4px 7px',
    fontSize: '12px',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: modified ? '700' : '400',
    outline: 'none',
    transition: 'border-color 0.15s',
  });

  // ── Upload logic ─────────────────────────────────────────────────────────

  const applyUploadRows = (rows: ReturnType<typeof parseGenerationUpload>) => {
    if (rows.length === 0) {
      setUploadMessage({
        type: 'error',
        text: 'No valid rows found. Use date (optional), block, wind_speed, and solar_mw columns.',
      });
      return;
    }

    const hasDateColumn = rows.some((r) => r.date !== undefined);

    if (hasDateColumn) {
      // Group by date and store in multiDayGenEdits
      const byDate: Record<string, Record<number, GenEdit>> = {};
      rows.forEach((row) => {
        const date = row.date!;
        if (!byDate[date]) byDate[date] = {};
        byDate[date][row.block] = {
          ...(byDate[date][row.block] ?? {}),
          ...(row.wind_speed !== undefined ? { wind_speed: row.wind_speed } : {}),
          ...(row.solar_mw !== undefined ? { solar_mw: row.solar_mw } : {}),
        };
      });

      setMultiDayGenEdits((prev) => ({ ...prev, ...byDate }));

      // Also immediately apply edits for the currently viewed date
      if (byDate[selectedDate]) {
        setGenTableEdits((prev) => ({ ...prev, ...byDate[selectedDate] }));
      }

      const dateCount = Object.keys(byDate).length;
      setUploadMessage({
        type: 'success',
        text: `Applied ${rows.length} rows across ${dateCount} date${dateCount === 1 ? '' : 's'} from upload.`,
      });
    } else {
      // Single-day upload — apply to current date
      const nextEdits: Record<number, GenEdit> = { ...genTableEdits };
      rows.forEach((row) => {
        nextEdits[row.block] = {
          ...(nextEdits[row.block] ?? {}),
          ...(row.wind_speed !== undefined ? { wind_speed: row.wind_speed } : {}),
          ...(row.solar_mw !== undefined ? { solar_mw: row.solar_mw } : {}),
        };
      });
      setGenTableEdits(nextEdits);
      setUploadMessage({
        type: 'success',
        text: `Applied ${rows.length} block${rows.length === 1 ? '' : 's'} from upload.`,
      });
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploadMessage(null);
    try {
      const text = await file.text();
      applyUploadRows(parseGenerationUpload(text));
    } catch {
      setUploadMessage({ type: 'error', text: 'Could not read the uploaded file.' });
    }
  };

  // ── Template download (multi-day) ─────────────────────────────────────────

  const handleDownloadTemplate = async () => {
    if (datesInRange.length === 0) {
      setUploadMessage({ type: 'error', text: 'Invalid date range. "From" must be before "To".' });
      return;
    }
    setTemplateLoading(true);
    setUploadMessage(null);
    try {
      const params = new URLSearchParams({
        wtg_count: String(wtgCount),
        solar_ac_mw: String(solarAc),
      });

      const allDateRows = await Promise.all(
        datesInRange.map(async (date) => {
          // Reuse already-loaded data for the current selected date
          if (date === selectedDate) {
            return {
              date,
              rows: rawForecast.map((r) => ({
                block: r.block,
                time: r.time,
                wind_speed: r.wind_speed,
                solar_mw_raw: r.solar_mw_raw,
              })),
            };
          }
          const resp = await fetch(`${BASE_URL}/api/generation/${date}?${params.toString()}`);
          if (!resp.ok) return { date, rows: [] as { block: number; time: string; wind_speed: number; solar_mw_raw: number }[] };
          const data: RawForecastRow[] = await resp.json();
          return {
            date,
            rows: data.map((r) => ({
              block: r.block,
              time: r.time,
              wind_speed: r.wind_speed,
              solar_mw_raw: r.solar_mw_raw,
            })),
          };
        })
      );

      const template = buildMultiDayGenerationTemplate(allDateRows);
      downloadTextFile(`generation_input_${fromDate}_to_${toDate}.csv`, template);
    } catch {
      setUploadMessage({ type: 'error', text: 'Failed to fetch forecast data for one or more dates.' });
    } finally {
      setTemplateLoading(false);
    }
  };

  // ── Paste handler ─────────────────────────────────────────────────────────

  const handlePaste = (e: React.ClipboardEvent, startBlock: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const rows = parseGenerationUpload(
      text.startsWith('block') ? text : `block,wind_speed,solar_mw\n${text}`
    );
    if (rows.length === 0) return;

    const newEdits = { ...genTableEdits };
    rows.forEach((row, i) => {
      const targetBlock = row.block || startBlock + i;
      if (targetBlock < 1 || targetBlock > 96) return;
      newEdits[targetBlock] = {
        ...(newEdits[targetBlock] ?? {}),
        ...(row.wind_speed !== undefined ? { wind_speed: row.wind_speed } : {}),
        ...(row.solar_mw !== undefined ? { solar_mw: row.solar_mw } : {}),
      };
    });
    setGenTableEdits(newEdits);
  };

  // Count how many dates have stored multi-day edits
  const storedDateCount = Object.keys(multiDayGenEdits).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="glass-panel generation-input-panel">
      <div className="generation-input-toolbar">
        <div className="generation-input-toolbar__left">
          <div>
            <h2 className="generation-input-title">Generation Input</h2>
            <p className="generation-input-subtitle">
              Select a date range to download a multi-day template, fill it in, then upload to bulk-apply wind speed &amp; solar data.
            </p>
          </div>
          <div className="generation-input-badges">
            <span className="generation-badge generation-badge--date">
              {formatSimulationDate(fromDate)} – {formatSimulationDate(toDate)}
              &nbsp;·&nbsp;{datesInRange.length} day{datesInRange.length !== 1 ? 's' : ''}
              &nbsp;·&nbsp;{datesInRange.length * 96} blocks
            </span>
            {modifiedCount > 0 && (
              <span className="generation-badge generation-badge--modified">
                {modifiedCount} modified (today)
              </span>
            )}
            {storedDateCount > 0 && (
              <span className="generation-badge generation-badge--stored">
                {storedDateCount} date{storedDateCount !== 1 ? 's' : ''} stored
              </span>
            )}
          </div>
        </div>

        <div className="generation-input-toolbar__right">
          {/* Date range picker */}
          <div className="date-range-picker">
            <Calendar size={14} style={{ color: '#64748b', flexShrink: 0 }} />
            <label className="generation-control" style={{ gap: '6px' }}>
              <span>From</span>
              <input
                id="gen-from-date"
                type="date"
                className="date-input"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setSelectedDate(e.target.value);
                }}
              />
            </label>
            <span style={{ color: '#475569', fontSize: '12px' }}>→</span>
            <label className="generation-control" style={{ gap: '6px' }}>
              <span>To</span>
              <input
                id="gen-to-date"
                type="date"
                className="date-input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.target.value = '';
            }}
          />

          <button
            id="gen-upload-btn"
            type="button"
            className="generation-action-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            Upload CSV
          </button>

          <button
            id="gen-template-btn"
            type="button"
            className="generation-action-btn"
            onClick={() => void handleDownloadTemplate()}
            disabled={templateLoading || datesInRange.length === 0}
          >
            <Download size={14} />
            {templateLoading ? 'Fetching…' : 'Template'}
          </button>

          {(modifiedCount > 0 || storedDateCount > 0) && (
            <button
              id="gen-reset-btn"
              type="button"
              className="generation-action-btn generation-action-btn--danger"
              onClick={() => {
                setGenTableEdits({});
                setMultiDayGenEdits({});
                setUploadMessage(null);
              }}
            >
              Reset All
            </button>
          )}
        </div>
      </div>

      {uploadMessage && (
        <div className={`generation-upload-message generation-upload-message--${uploadMessage.type}`}>
          {uploadMessage.text}
        </div>
      )}

      <div className="generation-input-help">
        <span>
          Multi-day CSV columns:&nbsp;
          <strong>date</strong>, <strong>block</strong>, <strong>wind_speed</strong>, <strong>solar_mw</strong>
        </span>
        <span>Single-day CSV: omit the date column — applies to the currently viewed day</span>
        <span>Paste from Excel into any editable cell to fill multiple rows</span>
        <span>Wind generation recalculates from the power curve when wind speed changes</span>
      </div>

      {/* Viewing banner */}
      <div className="generation-viewing-banner">
        <span>Viewing</span>
        <strong>{formatSimulationDate(selectedDate)}</strong>
        <span style={{ color: '#475569', fontSize: '11px' }}>· Switch dates on the optimizer page</span>
      </div>

      <div className="table-container gen-input-table" ref={genTableRef} key={selectedDate}>
        <table className="schedule-table generation-input-table__grid">
          <thead>
            <tr>
              <th>TB</th>
              <th>Time</th>
              <th>Wind Speed (m/s)</th>
              <th>Wind Gen (MW)</th>
              <th>Solar Gen (MW)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rawForecast.map((row) => {
              const edit = genTableEdits[row.block] ?? {};
              const isModified = !!genTableEdits[row.block];
              const isCurtailed = row.curtail_flag;

              const effWindSpeed =
                edit.wind_speed !== undefined ? edit.wind_speed : row.wind_speed.toFixed(2);
              const effWindMW =
                edit.wind_speed !== undefined && edit.wind_speed !== ''
                  ? lookupWindMW(parseFloat(edit.wind_speed), wtgCount)
                  : row.wind_mw_raw;
              const effSolarMW =
                edit.solar_mw !== undefined ? edit.solar_mw : row.solar_mw_raw.toFixed(3);

              const rowBg = isModified
                ? 'rgba(245,158,11,0.07)'
                : isCurtailed
                  ? 'rgba(239,68,68,0.03)'
                  : 'transparent';

              return (
                <tr
                  key={row.block}
                  className={isModified ? 'gen-modified-row' : ''}
                  style={{ background: rowBg, borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                >
                  <td className="mono-col" style={{ color: isModified ? '#fbbf24' : '#64748b', fontWeight: isModified ? '700' : '400' }}>
                    {row.block}
                  </td>
                  <td className="mono-col" style={{ color: '#64748b' }}>{row.time.substring(0, 5)}</td>

                  <td style={{ padding: '4px 8px' }}>
                    {isCurtailed ? (
                      <span className="generation-curtailed-label">Curtailed</span>
                    ) : (
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="25"
                        value={effWindSpeed}
                        style={cellInputStyle('#00d2ff', edit.wind_speed !== undefined)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGenTableEdits((prev) => ({
                            ...prev,
                            [row.block]: { ...(prev[row.block] ?? {}), wind_speed: v },
                          }));
                        }}
                        onPaste={(e) => handlePaste(e, row.block)}
                      />
                    )}
                  </td>

                  <td style={{ padding: '4px 8px' }}>
                    {isCurtailed ? (
                      <span className="generation-readonly-value generation-readonly-value--wind">0.000</span>
                    ) : (
                      <div className={`generation-readonly-value ${edit.wind_speed !== undefined ? 'generation-readonly-value--active' : ''}`}>
                        {effWindMW.toFixed(3)}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: '4px 8px' }}>
                    {isCurtailed ? (
                      <span className="generation-readonly-value generation-readonly-value--solar">0.000</span>
                    ) : (
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={effSolarMW}
                        style={cellInputStyle('var(--color-solar)', edit.solar_mw !== undefined)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGenTableEdits((prev) => ({
                            ...prev,
                            [row.block]: { ...(prev[row.block] ?? {}), solar_mw: v },
                          }));
                        }}
                        onPaste={(e) => handlePaste(e, row.block)}
                      />
                    )}
                  </td>

                  <td>
                    {isCurtailed ? (
                      <span className="cell-badge curtail">Curtailed</span>
                    ) : isModified ? (
                      <span className="cell-badge generation-edited-badge">Edited</span>
                    ) : (
                      <span className="generation-status-default">Forecast</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="generation-input-footer">
        <span>Siemens Gamesa SG 3.15-114 · {wtgCount} WTGs · Cut-in 3 m/s · Rated 11 m/s · Cut-out 18 m/s</span>
      </div>
    </section>
  );
}
