import type { ChargeLot } from '../types';

/** Expire all remaining lots at end of analysis horizon. */
export function finalizeChargeWindowLots(lots: ChargeLot[] | undefined): number {
  if (!lots?.length) return 0;
  return lots.reduce((sum, lot) => sum + lot.remaining_mwh, 0);
}

export function sumChargeWindowMetric(
  results: Array<{ schedule: { summary: { charge_window_charged_mwh?: number; charge_window_discharged_mwh?: number; charge_window_expired_mwh?: number } } }>,
  key: 'charge_window_charged_mwh' | 'charge_window_discharged_mwh' | 'charge_window_expired_mwh',
): number {
  return results.reduce((sum, r) => sum + (r.schedule.summary[key] ?? 0), 0);
}
