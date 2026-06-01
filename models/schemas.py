from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

# ── Request / Config Schemas ──────────────────────────────────────────────────

class ScheduleRequest(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format (June 2026)", examples=["2026-06-01"])
    wtg_count: int = Field(10, ge=1, le=59, description="Number of Wind Turbine Generators")
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0, description="Solar AC capacity in MW")
    rtc_commitment_mw: float = Field(50.0, ge=1.0, le=300.0, description="Daily RTC commitment target in MW")
    # Curtailment config
    curtailment_enabled: bool = Field(True, description="Whether curtailment window is active")
    curtailment_start_block: int = Field(37, ge=1, le=96, description="First curtailed block (inclusive)")
    curtailment_end_block: int = Field(64, ge=1, le=96, description="Last curtailed block (inclusive)")
    # PSP config
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0, description="PSP round-trip loss % (e.g. 20 = 20% loss)")
    min_compliance_ratio: float = Field(0.75, ge=0.5, le=1.0, description="Min delivery as fraction of RTC (0.75 = 75%)")
    max_soc_mwh: float = Field(360.0, ge=10.0, le=360.0, description="PSP maximum storage capacity in MWh (capped at 360 MWh)")
    min_dispatch_mw: float = Field(6.0, ge=0.0, le=60.0, description="Minimum PSP charge/discharge MW (CERC compliance — 0 or >= this value)")
    # Carry-forward from previous day
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=360.0, description="SoC carried forward from end of previous day (MWh)")
    prev_day_charge_schedule: Optional[List[float]] = Field(
        None, description="96-element array of PSP charge MW per block from previous day (kept for API compatibility)"
    )
    # Optional per-block data overrides (for the editable data tab)
    block_overrides: Optional[List[Dict[str, Any]]] = Field(
        None, description="Optional list of per-block overrides: {block, wind_mw, solar_mw}"
    )


class BlockSchedule(BaseModel):
    block: int
    time: str
    wind_mw: float
    solar_mw: float
    generation_mw: float
    psp_charge: float
    psp_discharge: float
    soc_start: float
    soc_end: float
    net_schedule: float
    rtm_surplus: float
    min_schedule: float
    compliant: bool
    curtail_flag: bool
    # Carry-forward fields
    carry_budget_mwh: float        # Carry-forward energy NOT yet expired at this block (MWh)
    carry_discharge_mw: float      # Portion of PSP discharge sourced from carry-forward SoC (MW)


class ScheduleSummary(BaseModel):
    rtc_commitment_mw: float
    min_schedule_mw: float
    min_compliance_ratio: float
    roundtrip_loss_pct: float
    total_charged_mwh: float
    psp_usable_charged_mwh: float     # Actual energy recoverable after losses
    total_discharged_mwh: float
    cycles_used: float
    min_soc_mwh: float
    max_soc_mwh: float
    end_soc_mwh: float
    compliant_blocks: int
    total_blocks: int
    fully_compliant: bool
    total_rtm_surplus_mwh: float
    # Carry-forward summary
    initial_soc_mwh: float            # SoC carried in from previous day
    carry_forward_available_mwh: float   # SoC (= initial_soc) carried in from previous day
    carry_forward_discharged_mwh: float  # How much carry energy was actually discharged


class CarryForwardInfo(BaseModel):
    initial_soc_mwh: float
    total_carry_available_mwh: float      # = initial_soc (EOD SoC from previous day)
    total_carry_discharged_mwh: float     # Carry energy actually discharged today
    today_charge_schedule: List[float]    # 96-element: MW charged per block today (pass as prev_day for next day)


class ScheduleResponse(BaseModel):
    blocks: List[BlockSchedule]
    summary: ScheduleSummary
    carry_forward: CarryForwardInfo


# ── Max RTC (binary search result) ───────────────────────────────────────────

class MaxRTCRequest(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format (June 2026)", examples=["2026-06-01"])
    wtg_count: int = Field(10, ge=1, le=59)
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.75, ge=0.5, le=1.0)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=360.0, description="SoC at start of day (MWh) — used in dispatch simulation")
    max_soc_mwh: float = Field(360.0, ge=10.0, le=360.0, description="PSP maximum storage capacity in MWh")
    min_dispatch_mw: float = Field(6.0, ge=0.0, le=60.0, description="Minimum PSP charge/discharge MW (CERC compliance)")


class MaxRTCResponse(BaseModel):
    max_rtc_commitment_mw: float
    schedule: ScheduleResponse


# ── RTC Range (Manikaran's Suggestion) ───────────────────────────────────────

class GenerationStats(BaseModel):
    min_mw: float
    p5_mw: float
    p10_mw: float
    mean_mw: float
    median_mw: float
    p90_mw: float
    p95_mw: float
    max_mw: float


class RTCRangeInterpretation(BaseModel):
    min_rtc_basis: str
    max_rtc_basis: str
    recommended_basis: str


class RTCRangeRequest(BaseModel):
    date: str = Field(..., examples=["2026-06-01"])
    wtg_count: int = Field(10, ge=1, le=59)
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.75, ge=0.5, le=1.0)
    max_soc_mwh: float = Field(360.0, ge=10.0, le=360.0)
    min_dispatch_mw: float = Field(6.0, ge=0.0, le=60.0)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=360.0, description="SoC at start of day (MWh) — used in the Manikaran Suggestion binary search")
    # Optional data overrides
    block_overrides: Optional[List[Dict[str, Any]]] = Field(None)


class RTCRangeResponse(BaseModel):
    non_curtailment_blocks: int
    curtailment_blocks: int
    curtailment_period_gen_lost_mwh: float
    generation_stats: GenerationStats
    psp_discharge_headroom_mw: float
    min_rtc_mw: float
    max_rtc_mw: float
    recommended_rtc_mw: float
    interpretation: RTCRangeInterpretation


# ── Multi-Day Max RTC (cross-day binary search) ───────────────────────────────

class MultiDayMaxRTCRequest(BaseModel):
    dates: List[str] = Field(..., description="Ordered list of dates in YYYY-MM-DD format")
    wtg_count: int = Field(10, ge=1, le=59)
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.75, ge=0.5, le=1.0)
    max_soc_mwh: float = Field(360.0, ge=10.0, le=360.0)
    min_dispatch_mw: float = Field(6.0, ge=0.0, le=60.0)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=360.0, description="SoC at start of day 1 (default 0 = clean slate)")


class MultiDayMaxRTCResponse(BaseModel):
    optimal_rtc_mw: float = Field(..., description="Max RTC (MW) where every block on every day is 100% compliant")
    days_analyzed: int
    period_start: str
    period_end: str

