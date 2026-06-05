export interface CurtailmentSegment {
  startBlock: number;
  endBlock: number;
  maxMw: number;
}

export interface PspDischargeSegment {
  startBlock: number;
  endBlock: number;
  maxDischargeMw: number; // 0 = no discharge allowed; >0 = discharge cap
}

export interface BlockData {
  block: number;
  time: string;
  wind_mw: number;
  solar_mw: number;
  generation_mw: number;
  psp_charge: number;
  psp_discharge: number;
  soc_start: number;
  soc_end: number;
  rtm_surplus: number;
  net_schedule: number;
  min_schedule: number;
  compliant: boolean;
  curtail_flag: boolean;
  carry_budget_mwh: number;
  carry_discharge_mw: number;
}

export interface RawForecastRow {
  block: number;
  time: string;
  wind_speed: number;
  wind_speed_2024: number;
  wind_speed_2025: number;
  wind_mw_raw: number;
  solar_mw_raw: number;
  curtail_flag: boolean;
}

export interface SummaryData {
  rtc_commitment_mw: number;
  min_schedule_mw: number;
  total_charged_mwh: number;
  total_discharged_mwh: number;
  cycles_used: number;
  min_soc_mwh: number;
  max_soc_mwh: number;
  end_soc_mwh: number;
  compliant_blocks: number;
  total_blocks: number;
  fully_compliant: boolean;
  total_rtm_surplus_mwh: number;
  total_net_delivered_mwh?: number;
  psp_usable_charged_mwh?: number;
  // Power wastage KPIs
  compliance_wasted_mwh?: number;
  potential_discharge_mwh?: number;
  shortfall_energy_mwh?: number;
}

export interface CarryForwardInfo {
  initial_soc_mwh: number;
  carry_budget_per_block: number[];
  carry_expires_per_block: number[];
  total_carry_available_mwh: number;
  total_carry_discharged_mwh: number;
  total_carry_expired_mwh: number;
  today_charge_schedule: number[];
}

export interface ScheduleResponse {
  blocks: BlockData[];
  summary: SummaryData;
  carry_forward: CarryForwardInfo;
}

export interface GenerationStats {
  min_mw: number;
  p5_mw: number;
  p10_mw: number;
  mean_mw: number;
  median_mw: number;
  p90_mw: number;
  p95_mw: number;
  max_mw: number;
}

export interface RTCRangeData {
  non_curtailment_blocks: number;
  curtailment_blocks: number;
  partial_curtailment_blocks: number;
  curtailment_period_gen_lost_mwh: number;  // backward compat: full + partial sum
  curtailment_full_loss_mwh: number;
  curtailment_partial_loss_mwh: number;
  generation_stats: GenerationStats;
  psp_discharge_headroom_mw: number;
  psp_curtailed_blocks: number;   // blocks excluded from RTC suggestion (PSP discharge = 0)
  min_rtc_mw: number;
  max_rtc_mw: number;
  recommended_rtc_mw: number;
  interpretation: {
    min_rtc_basis: string;
    max_rtc_basis: string;
    recommended_basis: string;
  };
}

export type GenEdit = { wind_speed?: string; solar_mw?: string };
