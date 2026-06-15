export interface ParsedUploadRow {
  date?: string;   // ISO date string (YYYY-MM-DD) present when uploading multi-day CSV
  block: number;
  wind_speed?: string;
  solar_mw?: string;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function findColumnIndex(headers: string[], matchers: string[]): number {
  return headers.findIndex((header) =>
    matchers.some((matcher) => header === matcher || header.includes(matcher))
  );
}

function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function parseNumericCell(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? String(num) : undefined;
}

export function parseGenerationUpload(text: string): ParsedUploadRow[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstCells = splitRow(lines[0]).map(normalizeHeader);
  const hasHeader =
    firstCells.some((cell) => cell.includes('block') || cell.includes('wind') || cell.includes('solar'));

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const headers = hasHeader ? firstCells : ['block', 'wind_speed', 'solar_mw'];

  const blockIdx = findColumnIndex(headers, ['block', 'tb', 'time_block']);
  const windIdx = findColumnIndex(headers, ['wind_speed', 'wind_speed_ms', 'wind', 'ws']);
  const solarIdx = findColumnIndex(headers, ['solar_mw', 'solar_gen', 'solar', 'solar_generation']);
  const dateIdx = findColumnIndex(headers, ['date', 'simulation_date', 'sim_date']);

  const resolvedBlockIdx = blockIdx >= 0 ? blockIdx : (dateIdx >= 0 ? 1 : 0);
  const resolvedWindIdx = windIdx >= 0 ? windIdx : (dateIdx >= 0 ? 2 : 1);
  const resolvedSolarIdx = solarIdx >= 0 ? solarIdx : (dateIdx >= 0 ? 3 : 2);

  const rows: ParsedUploadRow[] = [];

  dataLines.forEach((line, index) => {
    const cells = splitRow(line);
    const blockRaw = cells[resolvedBlockIdx] ?? String(index + 1);
    const block = parseInt(blockRaw, 10);
    if (!Number.isFinite(block) || block < 1 || block > 96) return;

    const wind_speed = parseNumericCell(cells[resolvedWindIdx]);
    const solar_mw = parseNumericCell(cells[resolvedSolarIdx]);
    const date = dateIdx >= 0 ? cells[dateIdx]?.trim() : undefined;

    if (wind_speed === undefined && solar_mw === undefined) return;

    rows.push({
      ...(date ? { date } : {}),
      block,
      ...(wind_speed !== undefined ? { wind_speed } : {}),
      ...(solar_mw !== undefined ? { solar_mw } : {}),
    });
  });

  return rows;
}

export function buildGenerationTemplate(rows: { block: number; time: string; wind_speed: number; solar_mw_raw: number }[]): string {
  const header = 'block,time,wind_speed,solar_mw';
  const body = rows
    .map((row) =>
      `${row.block},${row.time.substring(0, 5)},${row.wind_speed.toFixed(2)},${row.solar_mw_raw.toFixed(3)}`
    )
    .join('\n');
  return `${header}\n${body}\n`;
}

/** Builds a multi-day template CSV with a leading `date` column. */
export function buildMultiDayGenerationTemplate(
  dateRows: { date: string; rows: { block: number; time: string; wind_speed: number; solar_mw_raw: number }[] }[]
): string {
  const header = 'date,block,time,wind_speed,solar_mw';
  const body = dateRows
    .flatMap(({ date, rows }) =>
      rows.map(
        (row) =>
          `${date},${row.block},${row.time.substring(0, 5)},${row.wind_speed.toFixed(2)},${row.solar_mw_raw.toFixed(3)}`
      )
    )
    .join('\n');
  return `${header}\n${body}\n`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
