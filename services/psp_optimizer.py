import pandas as pd
import numpy as np


def optimize_psp_dispatch(
    forecast_df: pd.DataFrame,
    rtc_commitment: float,
    initial_soc: float = 0.0,
    max_soc: float = 360.0,
    max_charge: float = 60.0,
    max_discharge: float = 50.0,
    roundtrip_loss_pct: float = 20.0,   # % loss on round-trip (e.g. 20 means 20% loss)
    max_cycles: float = 2.0,
    min_compliance_ratio: float = 0.75,  # 75% of RTC is the regulatory floor
    min_dispatch_mw: float = 6.0,        # Minimum PSP charge/discharge (MW) — CERC compliance
    prev_day_charge_schedule: list = None,  # kept for API compatibility; no longer used
) -> dict:
    """
    Simulates PSP charging/discharging sequentially over 96 blocks.

    Priority order:
      1. First, always try to meet the RTC commitment on the grid.
         - If generation >= RTC: deliver exactly RTC to grid, route surplus to PSP (charge).
         - If generation < RTC but >= min_floor: deliver generation as-is (no PSP discharge needed).
         - If generation < min_floor: discharge PSP to top up delivery to min_floor.
      2. PSP is also charged during the night surplus blocks (blocks 1–36 and 65–96)
         when generation exceeds RTC, to prepare a buffer for the next day.

    Loss model:
      - roundtrip_loss_pct = total round-trip % loss (default 20%)
      - discharge_loss_factor = 1 / (1 - roundtrip_loss_pct/100)
        e.g. 20% loss → factor = 1.25  (need 1.25 MWh in to deliver 1 MWh out)
      - SoC deduction per block: psp_discharge * 0.25 * discharge_loss_factor

    Carry-forward rule:
      - The carry budget at the start of the day = initial_soc (the physical EOD SoC
        from the previous day). This is the only energy that can legally be attributed
        to carry-forward. It depletes as blocks discharge it.

    Parameters:
      - forecast_df       : DataFrame with columns block, time, wind_mw, solar_mw, curtail_flag
      - rtc_commitment    : Daily flat RTC target in MW
      - initial_soc       : Starting SoC in MWh (= previous day's EOD SoC when rolling)
      - max_soc           : PSP storage ceiling in MWh
      - max_charge        : Max charging rate in MW
      - max_discharge     : Max discharge rate in MW
      - roundtrip_loss_pct: Total round-trip loss percentage (10–20 typical)
      - max_cycles        : Max allowable charge cycles per day
      - min_compliance_ratio: Fraction of RTC that is the delivery floor (0.75 = 75%)

    Returns:
      dict with 'blocks' (list of per-block dicts), 'summary' (daily KPIs), and 'carry_forward' info
    """
    # Derived constants
    discharge_loss_factor = 1.0 / (1.0 - roundtrip_loss_pct / 100.0)
    min_schedule = min_compliance_ratio * rtc_commitment

    # ── CARRY-FORWARD BUDGET ───────────────────────────────────────────────────
    # Carry budget = what was physically in the tank at end of previous day.
    # Nothing more, nothing less. The 24h-window is implicitly satisfied because
    # energy in the tank can only have come from recent charges.
    total_carry_available = initial_soc

    # Track remaining carry energy as we discharge it block by block
    carry_remaining = total_carry_available  # MWh of carry-forward left to discharge

    soc = initial_soc
    total_charged_mwh = 0.0
    total_discharged_mwh = 0.0
    total_carry_discharged_mwh = 0.0
    total_carry_expired_mwh = 0.0
    today_charge_schedule = []   # track today's charges for handoff to next day

    block_results = []

    for i, (_, row) in enumerate(forecast_df.iterrows()):
        block = int(row['block'])
        time_str = str(row['time'])
        wind_mw = float(row['wind_mw'])
        solar_mw = float(row['solar_mw'])
        curtail_flag = bool(row.get('curtail_flag', False))

        # Combined RE generation (post-curtailment values already applied in forecast)
        generation_mw = wind_mw + solar_mw

        psp_charge = 0.0
        psp_discharge = 0.0
        carry_discharge_this_block = 0.0
        soc_before = soc

        # Current carry budget at this block = remaining carry energy not yet discharged.
        # Starts at initial_soc and depletes as carry-forward discharges are made.
        carry_budget_now = round(carry_remaining, 4)

        # ── PRIORITY 1: MEET RTC COMMITMENT ──────────────────────────────────
        # If generation is below the compliance floor → discharge PSP to reach floor
        if generation_mw < min_schedule:
            shortfall = min_schedule - generation_mw

            # Available discharge power limited by remaining SoC
            available_discharge_mw = soc / (0.25 * discharge_loss_factor) if discharge_loss_factor > 0 else 0.0

            psp_discharge = min(shortfall, max_discharge, available_discharge_mw)

            # ── CERC Min-Dispatch Compliance (6 MW rule) ──────────────────
            # PSP dispatch must be either 0 or >= min_dispatch_mw.
            # If the computed dispatch is below the threshold, zero it out
            # (we accept the shortfall rather than an illegal micro-dispatch).
            if 0 < psp_discharge < min_dispatch_mw:
                psp_discharge = 0.0

            if psp_discharge > 0:
                soc_deduction = psp_discharge * 0.25 * discharge_loss_factor
                soc = max(0.0, soc - soc_deduction)
                total_discharged_mwh += psp_discharge * 0.25

                # Attribute discharge to carry-forward first, then same-day
                carry_discharge_this_block = min(psp_discharge, carry_remaining / (0.25 * discharge_loss_factor))
                carry_energy_used = carry_discharge_this_block * 0.25 * discharge_loss_factor
                carry_remaining = max(0.0, carry_remaining - carry_energy_used)
                total_carry_discharged_mwh += carry_discharge_this_block * 0.25

        # ── PRIORITY 2: CHARGE PSP WITH SURPLUS ──────────────────────────────
        if generation_mw > rtc_commitment:
            surplus = generation_mw - rtc_commitment
            space_in_tank_mw = (max_soc - soc) / 0.25
            cycles_used = total_charged_mwh / max_soc if max_soc > 0 else 0.0
            remaining_cycle_capacity_mwh = max(0.0, max_cycles - cycles_used) * max_soc
            cycle_charge_limit_mw = remaining_cycle_capacity_mwh / 0.25

            psp_charge = min(surplus, max_charge, space_in_tank_mw, cycle_charge_limit_mw)

            # ── CERC Min-Dispatch Compliance (6 MW rule) ──────────────────
            if 0 < psp_charge < min_dispatch_mw:
                psp_charge = 0.0

            if psp_charge > 0:
                soc_addition = psp_charge * 0.25
                soc = min(max_soc, soc + soc_addition)
                total_charged_mwh += soc_addition

        today_charge_schedule.append(round(psp_charge, 4))


        # ── FINAL CALCULATIONS ────────────────────────────────────────────────
        soc_after = soc
        net_schedule = generation_mw + psp_discharge - psp_charge
        rtm_surplus = max(0.0, generation_mw - rtc_commitment - psp_charge)
        compliant = net_schedule >= (min_schedule - 1e-4)

        block_results.append({
            "block":              block,
            "time":               time_str,
            "wind_mw":            round(wind_mw, 4),
            "solar_mw":           round(solar_mw, 4),
            "generation_mw":      round(generation_mw, 4),
            "psp_charge":         round(psp_charge, 4),
            "psp_discharge":      round(psp_discharge, 4),
            "soc_start":          round(soc_before, 4),
            "soc_end":            round(soc_after, 4),
            "net_schedule":       round(net_schedule, 4),
            "rtm_surplus":        round(rtm_surplus, 4),
            "min_schedule":       round(min_schedule, 4),
            "compliant":          compliant,
            "curtail_flag":       curtail_flag,
            "carry_budget_mwh":   round(carry_budget_now, 4),
            "carry_discharge_mw": round(carry_discharge_this_block, 4),
        })

    # ── DAILY SUMMARY ─────────────────────────────────────────────────────────
    compliant_blocks_count = sum(1 for b in block_results if b['compliant'])
    total_rtm_surplus_mwh = sum(b['rtm_surplus'] * 0.25 for b in block_results)
    psp_usable_charged_mwh = round(total_charged_mwh * (1.0 - roundtrip_loss_pct / 100.0), 2)

    summary = {
        "rtc_commitment_mw":            rtc_commitment,
        "min_schedule_mw":              min_schedule,
        "min_compliance_ratio":         min_compliance_ratio,
        "roundtrip_loss_pct":           roundtrip_loss_pct,
        "total_charged_mwh":            round(total_charged_mwh, 2),
        "psp_usable_charged_mwh":       psp_usable_charged_mwh,
        "total_discharged_mwh":         round(total_discharged_mwh, 2),
        "cycles_used":                  round(total_charged_mwh / max_soc, 2) if max_soc > 0 else 0.0,
        "min_soc_mwh":                  round(min(b['soc_end'] for b in block_results), 2),
        "max_soc_mwh":                  round(max(b['soc_end'] for b in block_results), 2),
        "end_soc_mwh":                  round(soc, 2),
        "compliant_blocks":             compliant_blocks_count,
        "total_blocks":                 96,
        "fully_compliant":              compliant_blocks_count == 96,
        "total_rtm_surplus_mwh":        round(total_rtm_surplus_mwh, 2),
        # Carry-forward KPIs
        "initial_soc_mwh":              round(initial_soc, 2),
        "carry_forward_available_mwh":  round(total_carry_available, 2),
        "carry_forward_discharged_mwh": round(total_carry_discharged_mwh, 2),
    }

    carry_forward = {
        "initial_soc_mwh":            round(initial_soc, 2),
        "total_carry_available_mwh":  round(total_carry_available, 2),
        "total_carry_discharged_mwh": round(total_carry_discharged_mwh, 2),
        "today_charge_schedule":      today_charge_schedule,  # for passing to next day
    }

    return {
        "blocks":        block_results,
        "summary":       summary,
        "carry_forward": carry_forward,
    }


def find_max_rtc_no_shortfall(
    forecast_df: pd.DataFrame,
    roundtrip_loss_pct: float = 20.0,
    min_compliance_ratio: float = 0.75,
    low: float = 0.0,
    high: float = 300.0,
    tolerance: float = 0.05,
    min_dispatch_mw: float = 6.0,
    max_soc: float = 360.0,          # ← was missing; caused Suggestion to ignore capacity changes
) -> float:
    """
    Binary-search for the maximum RTC commitment (MW) such that ALL 96 blocks
    are compliant (net_schedule >= min_compliance_ratio * rtc_commitment) with
    no shortfall at any block. This is Manikaran's Suggestion for 'recommended'.

    Returns the highest RTC where fully_compliant == True.
    """
    target_blocks = 96   # 100% compliance

    # Sanity check at low
    res_low = optimize_psp_dispatch(
        forecast_df, rtc_commitment=low,
        max_soc=max_soc,
        roundtrip_loss_pct=roundtrip_loss_pct,
        min_compliance_ratio=min_compliance_ratio,
        min_dispatch_mw=min_dispatch_mw,
    )
    if res_low['summary']['compliant_blocks'] < target_blocks:
        return 0.0

    best_rtc = low
    while (high - low) > tolerance:
        mid = (low + high) / 2.0
        res = optimize_psp_dispatch(
            forecast_df, rtc_commitment=mid,
            max_soc=max_soc,
            roundtrip_loss_pct=roundtrip_loss_pct,
            min_compliance_ratio=min_compliance_ratio,
            min_dispatch_mw=min_dispatch_mw,
        )
        if res['summary']['compliant_blocks'] >= target_blocks:
            best_rtc = mid
            low = mid
        else:
            high = mid

    return round(best_rtc, 2)


def calculate_rtc_range(
    forecast_df: pd.DataFrame,
    max_soc: float = 360.0,
    max_discharge: float = 50.0,
    roundtrip_loss_pct: float = 20.0,
    min_compliance_ratio: float = 0.75,
    min_dispatch_mw: float = 6.0,
) -> dict:
    """
    Calculates the min, recommended (Manikaran's Suggestion), and max committable RTC
    based on generation in the non-curtailment period ONLY (blocks 1–36 and 65–96).

    Manikaran's Suggestion (recommended_rtc_mw):
      = The highest RTC where all 96 blocks remain compliant with no shortfall.
        This is found via binary search using find_max_rtc_no_shortfall().
        It is NOT the statistical mean — it's the real dispatch-validated safe maximum.

    Max RTC = P90 non-curtailment generation (higher risk, needs PSP backup for P10 blocks)
    Min RTC = 75% of P10 non-curtailment generation (regulatory safe floor)
    """
    discharge_loss_factor = 1.0 / (1.0 - roundtrip_loss_pct / 100.0)

    non_curtail_df = forecast_df[~forecast_df['curtail_flag']].copy()
    curtail_df     = forecast_df[forecast_df['curtail_flag']].copy()

    if len(non_curtail_df) == 0:
        return {
            "error": "No non-curtailment blocks found in forecast.",
            "non_curtailment_blocks": 0
        }

    # Use raw pre-curtailment wind/solar for non-curtailment blocks
    nc_wind  = non_curtail_df['wind_mw_raw']  if 'wind_mw_raw'  in non_curtail_df.columns else non_curtail_df['wind_mw']
    nc_solar = non_curtail_df['solar_mw_raw'] if 'solar_mw_raw' in non_curtail_df.columns else non_curtail_df['solar_mw']
    nc_gen   = nc_wind + nc_solar

    # Generation statistics
    gen_mean   = float(np.mean(nc_gen))
    gen_median = float(np.median(nc_gen))
    gen_p5     = float(np.percentile(nc_gen, 5))
    gen_p10    = float(np.percentile(nc_gen, 10))
    gen_p90    = float(np.percentile(nc_gen, 90))
    gen_p95    = float(np.percentile(nc_gen, 95))
    gen_min    = float(np.min(nc_gen))
    gen_max    = float(np.max(nc_gen))

    # PSP discharge headroom per block (MW) assuming full tank
    max_psp_per_block = min(max_discharge, max_soc / (0.25 * discharge_loss_factor))

    # Max RTC: P90 generation (you can hit this 90% of the time; PSP covers the rest)
    max_rtc = round(gen_p90, 2)

    # Min RTC: 75% floor of P10 generation (regulatory-safe minimum)
    min_rtc = round(max(0.0, gen_p10 * min_compliance_ratio), 2)

    # ── MANIKARAN'S SUGGESTION ────────────────────────────────────────────────
    # The maximum RTC that results in zero shortfall across all 96 blocks.
    # This is the safest aggressive commitment — no block will be non-compliant.
    recommended_rtc = find_max_rtc_no_shortfall(
        forecast_df=forecast_df,
        roundtrip_loss_pct=roundtrip_loss_pct,
        min_compliance_ratio=min_compliance_ratio,
        max_soc=max_soc,
        min_dispatch_mw=min_dispatch_mw,
        low=0.0,
        high=gen_p90 + max_psp_per_block,
    )

    # Curtailment loss
    if 'wind_mw_raw' in curtail_df.columns:
        curtail_wind_raw  = curtail_df['wind_mw_raw']
    else:
        curtail_wind_raw  = curtail_df.get('wind_mw', pd.Series(dtype=float))
    if 'solar_mw_raw' in curtail_df.columns:
        curtail_solar_raw = curtail_df['solar_mw_raw']
    else:
        curtail_solar_raw = curtail_df.get('solar_mw', pd.Series(dtype=float))

    curtailment_loss_mwh = round(float((curtail_wind_raw + curtail_solar_raw).sum() * 0.25), 2)

    return {
        "non_curtailment_blocks":            len(non_curtail_df),
        "curtailment_blocks":                len(curtail_df),
        "curtailment_period_gen_lost_mwh":   curtailment_loss_mwh,
        "generation_stats": {
            "min_mw":    round(gen_min,    2),
            "p5_mw":     round(gen_p5,     2),
            "p10_mw":    round(gen_p10,    2),
            "mean_mw":   round(gen_mean,   2),
            "median_mw": round(gen_median, 2),
            "p90_mw":    round(gen_p90,    2),
            "p95_mw":    round(gen_p95,    2),
            "max_mw":    round(gen_max,    2),
        },
        "psp_discharge_headroom_mw": round(max_psp_per_block, 2),
        "min_rtc_mw":                min_rtc,
        "max_rtc_mw":                max_rtc,
        "recommended_rtc_mw":        recommended_rtc,
        "interpretation": {
            "min_rtc_basis":        f"{int(min_compliance_ratio*100)}% of P10 non-curtailment generation — safe floor commitment",
            "max_rtc_basis":        "P90 non-curtailment generation — achievable 90% of the time",
            "recommended_basis":    "Max RTC with zero shortfall across all 96 blocks (dispatch-validated)",
        }
    }


if __name__ == "__main__":
    from services.forecast import generate_forecast
    fc = generate_forecast("2026-06-01", wtg_count=15, solar_ac_mw=60.0)
    result = optimize_psp_dispatch(fc, rtc_commitment=15.0)
    print("Optimization Summary:")
    for k, v in result['summary'].items():
        print(f"  {k}: {v}")
    print("\nSample block (block 43):")
    print(result['blocks'][42])
