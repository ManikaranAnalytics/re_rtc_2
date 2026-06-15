from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Dict, Any

from services.constants import (
    PSP_DEFAULT_CAPACITY_MWH,
    PSP_DEFAULT_MAX_CHARGE_MW,
    PSP_DEFAULT_MAX_DISCHARGE_MW,
    PSP_DEFAULT_MIN_DISPATCH_MW,
    PSP_MAX_CAPACITY_MWH,
    PSP_MAX_CHARGE_MW,
    PSP_MAX_DISCHARGE_MW,
    PSP_MAX_MIN_DISPATCH_MW,
    PSP_MIN_CAPACITY_MWH,
)

_PSP_MAX = PSP_MAX_CAPACITY_MWH
_PSP_MIN = PSP_MIN_CAPACITY_MWH
_PSP_DEFAULT = PSP_DEFAULT_CAPACITY_MWH

# ── Curtailment Segment ─────────────────────────────────────────────────────

class CurtailmentSegment(BaseModel):
    """A single curtailment window with an optional MW cap.

    maxMw == 0  → full curtailment (both wind and solar forced to 0).
    maxMw  > 0  → combined cap: wind_mw + solar_mw scaled so their sum <= maxMw.
    Blocks not covered by any segment are passed through uncurtailed.
    """
    startBlock: int = Field(..., ge=1, le=96, description="First curtailed block (inclusive)")
    endBlock:   int = Field(..., ge=1, le=96, description="Last curtailed block (inclusive)")
    maxMw:      float = Field(0.0, ge=0.0, description="Combined MW cap (0 = full curtailment)")

    @model_validator(mode='after')
    def end_after_start(self) -> 'CurtailmentSegment':
        if self.endBlock <= self.startBlock:
            raise ValueError(f"endBlock ({self.endBlock}) must be > startBlock ({self.startBlock})")
        return self


# ── PSP Discharge Segment ────────────────────────────────────────────────────

class PspDischargeSegment(BaseModel):
    """A block-range cap on PSP discharge output.

    maxDischargeMw == 0  → PSP discharge fully blocked in this window.
    maxDischargeMw  > 0  → PSP discharge capped to this MW value.
    Blocks not covered by any segment use the global max_discharge_mw.
    """
    startBlock:      int   = Field(..., ge=1, le=96, description="First restricted block (inclusive)")
    endBlock:        int   = Field(..., ge=1, le=96, description="Last restricted block (inclusive)")
    maxDischargeMw:  float = Field(0.0, ge=0.0, description="PSP discharge cap in MW (0 = blocked)")

    @model_validator(mode='after')
    def end_after_start(self) -> 'PspDischargeSegment':
        if self.endBlock <= self.startBlock:
            raise ValueError(f"endBlock ({self.endBlock}) must be > startBlock ({self.startBlock})")
        return self


# ── Request / Config Schemas ──────────────────────────────────────────────────

class ScheduleRequest(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format (June 2026)", examples=["2026-06-01"])
    wtg_count: int = Field(10, ge=1, le=59, description="Number of Wind Turbine Generators")
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0, description="Solar AC capacity in MW")
    rtc_commitment_mw: float = Field(50.0, ge=1.0, le=300.0, description="Daily RTC commitment target in MW")
    # Curtailment config — new segment-based system
    curtailment_segments: Optional[List[CurtailmentSegment]] = Field(
        None, description="Segment-based curtailment windows with per-segment MW caps. "
                          "When provided, overrides curtailment_start/end_block."
    )
    # Legacy fields kept for backward compatibility
    curtailment_enabled: bool = Field(True, description="Whether curtailment window is active (legacy; ignored when curtailment_segments is set)")
    curtailment_start_block: int = Field(37, ge=1, le=96, description="First curtailed block — legacy, used only when curtailment_segments is absent")
    curtailment_end_block: int = Field(64, ge=1, le=96, description="Last curtailed block — legacy, used only when curtailment_segments is absent")
    # PSP Discharge Curtailment — block-level discharge limits
    psp_discharge_segments: Optional[List[PspDischargeSegment]] = Field(
        None, description="Block-range caps on PSP discharge. 0 MW = fully blocked; >0 = partial cap."
    )
    # PSP config
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0, description="PSP round-trip loss % (e.g. 20 = 20% loss)")
    min_compliance_ratio: float = Field(0.50, ge=0.5, le=1.0, description="Min delivery as fraction of RTC (0.50 = 50%)")
    max_soc_mwh: float = Field(_PSP_DEFAULT, ge=_PSP_MIN, le=_PSP_MAX, description=f"PSP maximum storage capacity in MWh (up to {_PSP_MAX:.0f} MWh)")
    max_charge_mw: float = Field(PSP_DEFAULT_MAX_CHARGE_MW, ge=0.0, le=PSP_MAX_CHARGE_MW, description="Max PSP drawal (charging) rate in MW")
    max_discharge_mw: float = Field(PSP_DEFAULT_MAX_DISCHARGE_MW, ge=0.0, le=PSP_MAX_DISCHARGE_MW, description="Max PSP injection (discharge) rate in MW")
    min_dispatch_mw: float = Field(PSP_DEFAULT_MIN_DISPATCH_MW, ge=0.0, le=PSP_MAX_MIN_DISPATCH_MW, description="Minimum PSP charge/discharge MW (CERC — 0 or >= this value)")
    # Carry-forward from previous day
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=_PSP_MAX, description="SoC carried forward from end of previous day (MWh)")
    prev_day_charge_schedule: Optional[List[float]] = Field(
        None, description="96-element array of PSP charge MW per block from previous day (kept for API compatibility)"
    )
    prev_charge_lots: Optional[List[Dict[str, Any]]] = Field(
        None, description="FIFO charge lots carried from previous day(s) for 24h window tracking"
    )
    global_block_offset: int = Field(
        0, ge=0, description="Global block index offset (day_index * 96) for multi-day charge-window tracking"
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
    # 24h charge-window tracking
    charge_window_charged_mwh: float = 0.0
    charge_window_discharged_mwh: float = 0.0
    charge_window_expired_mwh: float = 0.0
    charge_window_outstanding_mwh: float = 0.0


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
    # 24h charge-window summary
    charge_window_charged_mwh: float = 0.0
    charge_window_discharged_mwh: float = 0.0
    charge_window_expired_mwh: float = 0.0
    charge_window_outstanding_mwh: float = 0.0


class CarryForwardInfo(BaseModel):
    initial_soc_mwh: float
    total_carry_available_mwh: float      # = initial_soc (EOD SoC from previous day)
    total_carry_discharged_mwh: float     # Carry energy actually discharged today
    today_charge_schedule: List[float]    # 96-element: MW charged per block today (pass as prev_day for next day)
    charge_lots: List[Dict[str, Any]] = Field(default_factory=list)


class ScheduleResponse(BaseModel):
    blocks: List[BlockSchedule]
    summary: ScheduleSummary
    carry_forward: CarryForwardInfo


# ── Max RTC (binary search result) ───────────────────────────────────────────

class MaxRTCRequest(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format (June 2026)", examples=["2026-06-01"])
    wtg_count: int = Field(10, ge=1, le=59)
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0)
    curtailment_segments: Optional[List[CurtailmentSegment]] = Field(None)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    psp_discharge_segments: Optional[List[PspDischargeSegment]] = Field(None)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.50, ge=0.5, le=1.0)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=_PSP_MAX, description="SoC at start of day (MWh) — used in dispatch simulation")
    max_soc_mwh: float = Field(_PSP_DEFAULT, ge=_PSP_MIN, le=_PSP_MAX, description="PSP maximum storage capacity in MWh")
    max_charge_mw: float = Field(PSP_DEFAULT_MAX_CHARGE_MW, ge=0.0, le=PSP_MAX_CHARGE_MW)
    max_discharge_mw: float = Field(PSP_DEFAULT_MAX_DISCHARGE_MW, ge=0.0, le=PSP_MAX_DISCHARGE_MW)
    min_dispatch_mw: float = Field(PSP_DEFAULT_MIN_DISPATCH_MW, ge=0.0, le=PSP_MAX_MIN_DISPATCH_MW, description="Minimum PSP charge/discharge MW (CERC compliance)")


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
    curtailment_segments: Optional[List[CurtailmentSegment]] = Field(None)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    psp_discharge_segments: Optional[List[PspDischargeSegment]] = Field(None)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.50, ge=0.5, le=1.0)
    max_soc_mwh: float = Field(_PSP_DEFAULT, ge=_PSP_MIN, le=_PSP_MAX)
    max_charge_mw: float = Field(PSP_DEFAULT_MAX_CHARGE_MW, ge=0.0, le=PSP_MAX_CHARGE_MW)
    max_discharge_mw: float = Field(PSP_DEFAULT_MAX_DISCHARGE_MW, ge=0.0, le=PSP_MAX_DISCHARGE_MW)
    min_dispatch_mw: float = Field(PSP_DEFAULT_MIN_DISPATCH_MW, ge=0.0, le=PSP_MAX_MIN_DISPATCH_MW)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=_PSP_MAX, description="SoC at start of day (MWh) — used in the Manikaran Suggestion binary search")
    # Optional data overrides
    block_overrides: Optional[List[Dict[str, Any]]] = Field(None)


class RTCRangeResponse(BaseModel):
    non_curtailment_blocks: int
    curtailment_blocks: int
    partial_curtailment_blocks: int = Field(0, description="Blocks covered by a maxMw>0 segment (included in RTC stats)")
    curtailment_period_gen_lost_mwh: float        # backward-compat: full + partial loss sum
    curtailment_full_loss_mwh: float = Field(0.0, description="Generation lost in full-curtailment blocks (MWh)")
    curtailment_partial_loss_mwh: float = Field(0.0, description="Generation lost to MW cap in partial-curtailment blocks (MWh)")
    generation_stats: GenerationStats
    psp_discharge_headroom_mw: float
    psp_curtailed_blocks: int = Field(0, description="Blocks excluded from RTC suggestion: PSP discharge fully blocked (maxDischargeMw=0)")
    min_rtc_mw: float
    max_rtc_mw: float
    recommended_rtc_mw: float
    interpretation: RTCRangeInterpretation


# ── Multi-Day Max RTC (cross-day binary search) ───────────────────────────────

class MultiDayMaxRTCRequest(BaseModel):
    dates: List[str] = Field(..., description="Ordered list of dates in YYYY-MM-DD format")
    wtg_count: int = Field(10, ge=1, le=59)
    solar_ac_mw: float = Field(50.0, ge=5.0, le=175.0)
    curtailment_segments: Optional[List[CurtailmentSegment]] = Field(None)
    curtailment_enabled: bool = Field(True)
    curtailment_start_block: int = Field(37, ge=1, le=96)
    curtailment_end_block: int = Field(64, ge=1, le=96)
    psp_discharge_segments: Optional[List[PspDischargeSegment]] = Field(None)
    roundtrip_loss_pct: float = Field(20.0, ge=0.0, le=50.0)
    min_compliance_ratio: float = Field(0.50, ge=0.5, le=1.0)
    max_soc_mwh: float = Field(_PSP_DEFAULT, ge=_PSP_MIN, le=_PSP_MAX)
    max_charge_mw: float = Field(PSP_DEFAULT_MAX_CHARGE_MW, ge=0.0, le=PSP_MAX_CHARGE_MW)
    max_discharge_mw: float = Field(PSP_DEFAULT_MAX_DISCHARGE_MW, ge=0.0, le=PSP_MAX_DISCHARGE_MW)
    min_dispatch_mw: float = Field(PSP_DEFAULT_MIN_DISPATCH_MW, ge=0.0, le=PSP_MAX_MIN_DISPATCH_MW)
    initial_soc_mwh: float = Field(0.0, ge=0.0, le=_PSP_MAX, description="SoC at start of day 1 (default 0 = clean slate)")


class MultiDayMaxRTCResponse(BaseModel):
    optimal_rtc_mw: float = Field(..., description="Max RTC (MW) where every block on every day is 100% compliant")
    days_analyzed: int
    period_start: str
    period_end: str

