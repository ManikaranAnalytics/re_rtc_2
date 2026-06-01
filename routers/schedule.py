import pandas as pd
from fastapi import APIRouter, HTTPException
from models.schemas import (
    ScheduleRequest, ScheduleResponse,
    MaxRTCRequest, MaxRTCResponse,
    RTCRangeRequest, RTCRangeResponse,
    MultiDayMaxRTCRequest, MultiDayMaxRTCResponse,
)
from services.forecast import generate_forecast
from services.psp_optimizer import optimize_psp_dispatch, find_max_rtc_no_shortfall, calculate_rtc_range, find_max_rtc_multiday

router = APIRouter()


def _apply_overrides(forecast_df: pd.DataFrame, overrides) -> pd.DataFrame:
    """Apply per-block wind/solar overrides from the editable data tab."""
    if not overrides:
        return forecast_df
    df = forecast_df.copy()
    override_map = {int(o['block']): o for o in overrides}
    for idx, row in df.iterrows():
        b = int(row['block'])
        if b in override_map:
            ov = override_map[b]
            # Preserve curtail_flag — overrides only touch the generation values
            if 'wind_mw' in ov:
                df.at[idx, 'wind_mw']     = float(ov['wind_mw'])
                df.at[idx, 'wind_mw_raw'] = float(ov['wind_mw'])
            if 'solar_mw' in ov:
                df.at[idx, 'solar_mw']     = float(ov['solar_mw'])
                df.at[idx, 'solar_mw_raw'] = float(ov['solar_mw'])
    return df


@router.post("/schedule", response_model=ScheduleResponse)
def get_optimal_schedule(request: ScheduleRequest):
    """
    Accepts turbine count, solar capacity, RTC commitment, and a date.
    Calculates the 96-block generation forecast and runs the sequential PSP optimization.

    Priority: RTC first → PSP only charges on surplus, discharges only on shortfall.
    75% of RTC is the compliance floor (regulatory minimum delivery).
    """
    try:
        forecast_df = generate_forecast(
            date_str=request.date,
            wtg_count=request.wtg_count,
            solar_ac_mw=request.solar_ac_mw,
            curtailment_enabled=request.curtailment_enabled,
            curtailment_start_block=request.curtailment_start_block,
            curtailment_end_block=request.curtailment_end_block,
        )

        # Apply any user-edited block overrides
        forecast_df = _apply_overrides(forecast_df, request.block_overrides)

        dispatch_results = optimize_psp_dispatch(
            forecast_df=forecast_df,
            rtc_commitment=request.rtc_commitment_mw,
            initial_soc=request.initial_soc_mwh,
            max_soc=request.max_soc_mwh,
            roundtrip_loss_pct=request.roundtrip_loss_pct,
            min_compliance_ratio=request.min_compliance_ratio,
            min_dispatch_mw=request.min_dispatch_mw,
            prev_day_charge_schedule=request.prev_day_charge_schedule,
        )

        return dispatch_results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scheduling optimization failed: {str(e)}")


@router.post("/max-rtc", response_model=MaxRTCResponse)
def get_max_possible_rtc(request: MaxRTCRequest):
    """
    Calculates the maximum RTC commitment where ALL 96 blocks remain compliant
    (no shortfall at any block). Returns the schedule for that commitment.
    """
    try:
        forecast_df = generate_forecast(
            date_str=request.date,
            wtg_count=request.wtg_count,
            solar_ac_mw=request.solar_ac_mw,
            curtailment_enabled=request.curtailment_enabled,
            curtailment_start_block=request.curtailment_start_block,
            curtailment_end_block=request.curtailment_end_block,
        )

        max_rtc = find_max_rtc_no_shortfall(
            forecast_df=forecast_df,
            roundtrip_loss_pct=request.roundtrip_loss_pct,
            min_compliance_ratio=request.min_compliance_ratio,
            initial_soc=request.initial_soc_mwh,
            max_soc=request.max_soc_mwh,
            min_dispatch_mw=request.min_dispatch_mw,
        )

        dispatch_results = optimize_psp_dispatch(
            forecast_df=forecast_df,
            rtc_commitment=max_rtc,
            initial_soc=request.initial_soc_mwh,
            max_soc=request.max_soc_mwh,
            min_dispatch_mw=request.min_dispatch_mw,
            roundtrip_loss_pct=request.roundtrip_loss_pct,
            min_compliance_ratio=request.min_compliance_ratio,
        )

        return MaxRTCResponse(
            max_rtc_commitment_mw=max_rtc,
            schedule=dispatch_results,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate maximum possible RTC: {str(e)}")


@router.post("/rtc-range", response_model=RTCRangeResponse)
def get_rtc_range(request: RTCRangeRequest):
    """
    Returns min / Manikaran's Suggestion / max committable RTC for the given plant config.

    - min_rtc_mw        : 75% of P10 non-curtailment generation (safe floor)
    - recommended_rtc_mw: Max RTC with 100% block compliance (zero shortfall) — Manikaran's Suggestion
    - max_rtc_mw        : P90 non-curtailment generation (needs PSP backup for ~10% blocks)

    Curtailment window (configurable) is excluded from the analysis.
    """
    try:
        forecast_df = generate_forecast(
            date_str=request.date,
            wtg_count=request.wtg_count,
            solar_ac_mw=request.solar_ac_mw,
            curtailment_enabled=request.curtailment_enabled,
            curtailment_start_block=request.curtailment_start_block,
            curtailment_end_block=request.curtailment_end_block,
        )

        forecast_df = _apply_overrides(forecast_df, request.block_overrides)

        result = calculate_rtc_range(
            forecast_df=forecast_df,
            roundtrip_loss_pct=request.roundtrip_loss_pct,
            min_compliance_ratio=request.min_compliance_ratio,
            max_soc=request.max_soc_mwh,
            min_dispatch_mw=request.min_dispatch_mw,
            initial_soc=request.initial_soc_mwh,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate RTC range: {str(e)}")


@router.post("/multi-day-max-rtc", response_model=MultiDayMaxRTCResponse)
def get_multi_day_max_rtc(request: MultiDayMaxRTCRequest):
    """
    True cross-day optimal RTC: binary-searches for the maximum RTC commitment
    where every block on every requested day is 100% compliant, with SOC
    correctly chained day-over-day.

    Unlike the single-day /rtc-range endpoint, this is NOT influenced by the
    user's current RTC config — it independently finds the global optimum.
    """
    try:
        if not request.dates:
            raise ValueError("At least one date is required.")

        # Generate forecast DataFrames for all days up-front
        forecast_dfs = [
            generate_forecast(
                date_str=date,
                wtg_count=request.wtg_count,
                solar_ac_mw=request.solar_ac_mw,
                curtailment_enabled=request.curtailment_enabled,
                curtailment_start_block=request.curtailment_start_block,
                curtailment_end_block=request.curtailment_end_block,
            )
            for date in request.dates
        ]

        # Determine binary search upper bound: P90 of generation across all days
        # + max possible PSP discharge contribution, so we don't cap the search
        import numpy as np
        all_gen = np.concatenate([
            (df['wind_mw'] + df['solar_mw']).values for df in forecast_dfs
        ])
        search_high = float(np.percentile(all_gen, 90)) + 50.0  # generous upper bound

        optimal_rtc = find_max_rtc_multiday(
            forecast_dfs=forecast_dfs,
            roundtrip_loss_pct=request.roundtrip_loss_pct,
            min_compliance_ratio=request.min_compliance_ratio,
            min_dispatch_mw=request.min_dispatch_mw,
            max_soc=request.max_soc_mwh,
            initial_soc=request.initial_soc_mwh,
            low=0.0,
            high=search_high,
        )

        return MultiDayMaxRTCResponse(
            optimal_rtc_mw=optimal_rtc,
            days_analyzed=len(request.dates),
            period_start=request.dates[0],
            period_end=request.dates[-1],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Multi-day max RTC search failed: {str(e)}")
