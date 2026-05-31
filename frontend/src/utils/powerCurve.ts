import { POWER_CURVE_KW } from './constants';

export function lookupWindMW(windSpeed: number, wtgCount: number): number {
  const rounded = Math.round(windSpeed * 10) / 10;
  if (rounded < 3.0 || rounded > 18.0) return 0;
  // Find nearest 0.1 step in table
  const key = rounded.toFixed(1);
  const kw = POWER_CURVE_KW[key] ?? 0;
  return (kw / 1000) * wtgCount;
}
