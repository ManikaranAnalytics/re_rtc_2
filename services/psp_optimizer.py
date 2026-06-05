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
    min_compliance_ratio: float = 0.50,  # 50% of RTC is the regulatory floor
    min_dispatch_mw: float = 6.0,        # Minimum PSP charge/discharge (MW) — CERC compliance
    prev_day_charge_schedule: list = None,  # kept for API compatibility; no longer used
    psp_discharge_segments: list = None,    # [{startBlock, endBlock, maxDischargeMw}, ...]
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
      - min_compliance_ratio: Fraction of RTC that is the delivery floor (0.50 = 50%)

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

    # Power wastage accumulators
    compliance_wasted_mwh = 0.0    # energy lost due to CERC 6MW min-dispatch rule
    potential_discharge_mwh = 0.0  # max theoretical PSP discharge (sum of all shortfalls)

    # ── PSP DISCHARGE SEGMENTS ─ build lookup: block → effective max discharge ──
    # Segments override per-block max_discharge. Blocks not covered use global max_discharge.
    discharge_cap_by_block: dict = {}  # block_number -> capped max discharge MW
    if psp_discharge_segments:
        for seg in psp_discharge_segments:
            cap = float(seg.get('maxDischargeMw', max_discharge))
            for b in range(int(seg['startBlock']), int(seg['endBlock']) + 1):
                discharge_cap_by_block[b] = min(max_discharge, cap)

    block_results = []

    for i, (_, row) in enumerate(forecast_df.iterrows()):
        block = int(row['block'])
        time_str = str(row['time'])
        wind_mw = float(row['wind_mw'])
        solar_mw = float(row['solar_mw'])
        curtail_flag = bool(row.get('curtail_flag', False))

        # generation_mw now reflects combined MW cap from curtailment segment (not hard zero)
        # PSP discharge gap = max(0, min_schedule - generation_mw)
        generation_mw = wind_mw + solar_mw

        # Effective per-block discharge cap (from segment config or global max)
        effective_max_discharge = discharge_cap_by_block.get(block, max_discharge)

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

            # Track the potential (unconstrained) discharge opportunity
            potential_discharge_mwh += shortfall * 0.25

            # Available discharge power limited by remaining SoC
            available_discharge_mw = soc / (0.25 * discharge_loss_factor) if discharge_loss_factor > 0 else 0.0

            # What we would dispatch ignoring CERC 6MW rule
            unconstrained_dispatch = min(shortfall, effective_max_discharge, available_discharge_mw)

            psp_discharge = unconstrained_dispatch

            # ── CERC Min-Dispatch Compliance (6 MW rule) ──────────────────
            # PSP dispatch must be either 0 or >= min_dispatch_mw.
            # If the computed dispatch is below the threshold, bump it up to
            # min_dispatch_mw (slight overdelivery is acceptable vs. a shortfall).
            # Re-cap against hardware and SOC limits after the bump.
            if 0 < psp_discharge < min_dispatch_mw:
                bumped = min(min_dispatch_mw, effective_max_discharge, available_discharge_mw)
                if bumped < min_dispatch_mw:
                    # Cannot meet the 6 MW floor — forced to dispatch 0 (compliance waste)
                    compliance_wasted_mwh += unconstrained_dispatch * 0.25
                    psp_discharge = 0.0
                else:
                    psp_discharge = bumped

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
    total_net_delivered_mwh = sum(b['net_schedule'] * 0.25 for b in block_results)
    # Energy deficit for non-compliant blocks: sum of (floor - net_schedule) * 0.25h
    # Use the raw gap directly (not gated on compliant flag, which has a 1e-4 tolerance)
    shortfall_energy_mwh = sum(
        max(0.0, b['min_schedule'] - b['net_schedule']) * 0.25
        for b in block_results
        if b['net_schedule'] < b['min_schedule'] - 1e-9
    )
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
        "total_net_delivered_mwh":       round(total_net_delivered_mwh, 2),
        # Carry-forward KPIs
        "initial_soc_mwh":              round(initial_soc, 2),
        "carry_forward_available_mwh":  round(total_carry_available, 2),
        "carry_forward_discharged_mwh": round(total_carry_discharged_mwh, 2),
        # Power wastage KPIs
        "compliance_wasted_mwh":        round(compliance_wasted_mwh, 2),
        "potential_discharge_mwh":      round(potential_discharge_mwh, 2),
        "shortfall_energy_mwh":         round(shortfall_energy_mwh, 2),
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


def _count_psp_curtailed_blocks(psp_discharge_segments: list) -> int:
    """
    Count how many of the 96 blocks fall inside a PSP discharge segment
    with maxDischargeMw == 0 (fully blocked).  These blocks cannot use PSP
    to cover generation shortfalls, so they should be excluded from the
    RTC compliance requirement in the binary search.

    Segments are dicts produced by Pydantic model_dump() so keys are
    camelCase: startBlock / endBlock / maxDischargeMw.
    """
    if not psp_discharge_segments:
        return 0
    curtailed = set()
    for seg in psp_discharge_segments:
        # Support both camelCase (from Pydantic model_dump) and snake_case
        max_disch = seg.get('maxDischargeMw', seg.get('max_discharge_mw', 1))
        start     = seg.get('startBlock',     seg.get('start_block',     None))
        end       = seg.get('endBlock',       seg.get('end_block',       None))
        if max_disch == 0 and start is not None and end is not None:
            for b in range(int(start), int(end) + 1):
                curtailed.add(b)
    return len(curtailed)


def find_max_rtc_no_shortfall(
    forecast_df: pd.DataFrame,
    roundtrip_loss_pct: float = 20.0,
    min_compliance_ratio: float = 0.50,
    low: float = 0.0,
    high: float = 300.0,
    tolerance: float = 0.05,
    min_dispatch_mw: float = 6.0,
    max_soc: float = 360.0,
    max_charge: float = 60.0,
    max_discharge: float = 50.0,
    initial_soc: float = 0.0,
    psp_discharge_segments: list = None,
) -> float:
    """
    Binary-search for the maximum RTC commitment (MW) such that all
    non-PSP-curtailed blocks are compliant (net_schedule >=
    min_compliance_ratio * rtc_commitment).  Blocks where PSP discharge is
    fully curtailed (maxDischargeMw == 0) are excluded from the target count
    because PSP cannot bridge their generation gap.  This is Manikaran's
    Suggestion for 'recommended'.

    Returns the highest RTC where all evaluable blocks are compliant.
    """
    # Blocks that are fully PSP-curtailed cannot be expected to be compliant
    curtailed_block_count = _count_psp_curtailed_blocks(psp_discharge_segments)
    target_blocks = 96 - curtailed_block_count   # only non-curtailed blocks must comply

    if target_blocks <= 0:
        return 0.0   # everything is curtailed — no useful RTC to suggest

    def compliant_count(rtc: float) -> int:
        res = optimize_psp_dispatch(
            forecast_df, rtc_commitment=rtc,
            max_soc=max_soc,
            max_charge=max_charge,
            max_discharge=max_discharge,
            initial_soc=initial_soc,
            roundtrip_loss_pct=roundtrip_loss_pct,
            min_compliance_ratio=min_compliance_ratio,
            min_dispatch_mw=min_dispatch_mw,
            psp_discharge_segments=psp_discharge_segments,
        )
        return res['summary']['compliant_blocks']

    # Sanity check at low — if even the lowest bound fails, return 0
    if compliant_count(low) < target_blocks:
        return 0.0

    best_rtc = low
    while (high - low) > tolerance:
        mid = (low + high) / 2.0
        if compliant_count(mid) >= target_blocks:
            best_rtc = mid
            low = mid
        else:
            high = mid

    return round(best_rtc, 2)


def find_max_rtc_multiday(
    forecast_dfs: list,
    roundtrip_loss_pct: float = 20.0,
    min_compliance_ratio: float = 0.50,
    min_dispatch_mw: float = 6.0,
    max_soc: float = 360.0,
    max_charge: float = 60.0,
    max_discharge: float = 50.0,
    initial_soc: float = 0.0,
    low: float = 0.0,
    high: float = 300.0,
    tolerance: float = 0.05,
    psp_discharge_segments: list = None,
) -> float:
    """
    Binary-search for the maximum RTC commitment (MW) such that all
    non-PSP-curtailed blocks across ALL provided days are compliant,
    with SOC correctly chained between days.

    PSP-discharge-curtailed blocks (maxDischargeMw == 0) are excluded from
    the compliance requirement — they cannot use PSP so should not penalise
    the RTC recommendation.
    """
    # Compute how many blocks per day are excluded due to full PSP curtailment
    curtailed_block_count = _count_psp_curtailed_blocks(psp_discharge_segments)
    target_blocks_per_day = 96 - curtailed_block_count

    if target_blocks_per_day <= 0:
        return 0.0

    def all_days_compliant(rtc: float) -> bool:
        soc = initial_soc
        for df in forecast_dfs:
            result = optimize_psp_dispatch(
                df,
                rtc_commitment=rtc,
                initial_soc=soc,
                max_soc=max_soc,
                max_charge=max_charge,
                max_discharge=max_discharge,
                roundtrip_loss_pct=roundtrip_loss_pct,
                min_compliance_ratio=min_compliance_ratio,
                min_dispatch_mw=min_dispatch_mw,
                psp_discharge_segments=psp_discharge_segments,
            )
            # Pass if all evaluable (non-PSP-curtailed) blocks are compliant
            if result['summary']['compliant_blocks'] < target_blocks_per_day:
                return False
            soc = result['summary']['end_soc_mwh']
        return True

    if not all_days_compliant(low):
        return 0.0

    best_rtc = low
    while (high - low) > tolerance:
        mid = (low + high) / 2.0
        if all_days_compliant(mid):
            best_rtc = mid
            low = mid
        else:
            high = mid

    return round(best_rtc, 2)


def calculate_rtc_range(
    forecast_df: pd.DataFrame,
    max_soc: float = 360.0,
    max_charge: float = 60.0,
    max_discharge: float = 50.0,
    roundtrip_loss_pct: float = 20.0,
    min_compliance_ratio: float = 0.50,
    min_dispatch_mw: float = 6.0,
    initial_soc: float = 0.0,
    psp_discharge_segments: list = None,
) -> dict:
    """
    Calculates the min, recommended (Manikaran's Suggestion), and max committable RTC
    based on generation in the non-curtailment period ONLY (blocks 1–36 and 65–96).

    Manikaran's Suggestion (recommended_rtc_mw):
      = The highest RTC where all 96 blocks remain compliant with no shortfall.
        This is found via binary search using find_max_rtc_no_shortfall().
        It is NOT the statistical mean — it's the real dispatch-validated safe maximum.

    Max RTC = P90 non-curtailment generation (higher risk, needs PSP backup for P10 blocks)
    Min RTC = 50% of P10 non-curtailment generation (regulatory safe floor)
    """
    discharge_loss_factor = 1.0 / (1.0 - roundtrip_loss_pct / 100.0)

    # Split forecast into three groups based on curtailment type:
    #   full_curtail_df  : curtail_flag == True  (maxMw=0) — excluded from RTC stats
    #   partial_curtail_df: curtail_partial_flag == True (maxMw>0) — included in RTC stats
    #   non_curtail_df   : neither — included normally
    has_partial_col = 'curtail_partial_flag' in forecast_df.columns

    full_curtail_df    = forecast_df[forecast_df['curtail_flag']].copy()
    if has_partial_col:
        partial_curtail_df = forecast_df[
            ~forecast_df['curtail_flag'] & forecast_df['curtail_partial_flag']
        ].copy()
        non_curtail_df = forecast_df[
            ~forecast_df['curtail_flag'] & ~forecast_df['curtail_partial_flag']
        ].copy()
    else:
        partial_curtail_df = pd.DataFrame()
        non_curtail_df     = forecast_df[~forecast_df['curtail_flag']].copy()

    # RTC stats are computed over non-curtailed + partial-curtailed blocks.
    # For partial blocks we use the CAPPED generation (wind_mw + solar_mw),
    # not the raw values, because that is what will actually be dispatched.
    # For non-curtailment blocks we use raw pre-curtailment values (as before).
    if len(partial_curtail_df) > 0:
        pc_gen = partial_curtail_df['wind_mw'] + partial_curtail_df['solar_mw']
    else:
        pc_gen = pd.Series(dtype=float)

    nc_wind  = non_curtail_df['wind_mw_raw']  if 'wind_mw_raw'  in non_curtail_df.columns else non_curtail_df['wind_mw']
    nc_solar = non_curtail_df['solar_mw_raw'] if 'solar_mw_raw' in non_curtail_df.columns else non_curtail_df['solar_mw']
    nc_gen   = nc_wind + nc_solar

    # Combine for stats
    stat_gen = pd.concat([nc_gen, pc_gen], ignore_index=True)

    if len(stat_gen) == 0:
        return {
            "error": "No non-curtailment blocks found in forecast.",
            "non_curtailment_blocks": 0
        }

    # Generation statistics
    gen_mean   = float(np.mean(stat_gen))
    gen_median = float(np.median(stat_gen))
    gen_p5     = float(np.percentile(stat_gen, 5))
    gen_p10    = float(np.percentile(stat_gen, 10))
    gen_p90    = float(np.percentile(stat_gen, 90))
    gen_p95    = float(np.percentile(stat_gen, 95))
    gen_min    = float(np.min(stat_gen))
    gen_max    = float(np.max(stat_gen))

    # PSP discharge headroom per block (MW) assuming full tank
    max_psp_per_block = min(max_discharge, max_soc / (0.25 * discharge_loss_factor))

    # Max RTC: P90 generation (you can hit this 90% of the time; PSP covers the rest)
    max_rtc = round(gen_p90, 2)

    # Min RTC: 50% floor of P10 generation (regulatory-safe minimum)
    min_rtc = round(max(0.0, gen_p10 * min_compliance_ratio), 2)

    # -- MANIKARAN'S SUGGESTION -----------------------------------------------
    # The maximum RTC that results in zero shortfall across all 96 blocks,
    # using the actual initial SOC so the search reflects real dispatch conditions.
    recommended_rtc = find_max_rtc_no_shortfall(
        forecast_df=forecast_df,
        roundtrip_loss_pct=roundtrip_loss_pct,
        min_compliance_ratio=min_compliance_ratio,
        max_soc=max_soc,
        max_charge=max_charge,
        max_discharge=max_discharge,
        min_dispatch_mw=min_dispatch_mw,
        initial_soc=initial_soc,
        low=0.0,
        high=gen_p90 + max_psp_per_block,
        psp_discharge_segments=psp_discharge_segments,
    )

    # -- Curtailment loss reporting -------------------------------------------
    # Full curtailment loss: raw generation that was zeroed
    if len(full_curtail_df) > 0:
        fc_wind  = full_curtail_df['wind_mw_raw']  if 'wind_mw_raw'  in full_curtail_df.columns else full_curtail_df.get('wind_mw',  pd.Series(dtype=float))
        fc_solar = full_curtail_df['solar_mw_raw'] if 'solar_mw_raw' in full_curtail_df.columns else full_curtail_df.get('solar_mw', pd.Series(dtype=float))
        full_loss_mwh = round(float((fc_wind + fc_solar).sum() * 0.25), 2)
    else:
        full_loss_mwh = 0.0

    # Partial curtailment loss: difference between raw combined and the cap
    if len(partial_curtail_df) > 0 and has_partial_col:
        pc_wind_raw  = partial_curtail_df['wind_mw_raw']  if 'wind_mw_raw'  in partial_curtail_df.columns else partial_curtail_df['wind_mw']
        pc_solar_raw = partial_curtail_df['solar_mw_raw'] if 'solar_mw_raw' in partial_curtail_df.columns else partial_curtail_df['solar_mw']
        pc_combined_raw = pc_wind_raw + pc_solar_raw
        pc_capped       = partial_curtail_df['wind_mw'] + partial_curtail_df['solar_mw']
        partial_loss_mwh = round(float(((pc_combined_raw - pc_capped).clip(lower=0)).sum() * 0.25), 2)
    else:
        partial_loss_mwh = 0.0

    total_loss_mwh = round(full_loss_mwh + partial_loss_mwh, 2)

    return {
        "non_curtailment_blocks":            len(non_curtail_df),
        "curtailment_blocks":                len(full_curtail_df),
        "partial_curtailment_blocks":        len(partial_curtail_df),
        "curtailment_period_gen_lost_mwh":   total_loss_mwh,     # backward compat
        "curtailment_full_loss_mwh":         full_loss_mwh,
        "curtailment_partial_loss_mwh":      partial_loss_mwh,
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
        "psp_curtailed_blocks":      _count_psp_curtailed_blocks(psp_discharge_segments),
        "min_rtc_mw":                min_rtc,
        "max_rtc_mw":                max_rtc,
        "recommended_rtc_mw":        recommended_rtc,
        "interpretation": {
            "min_rtc_basis":        f"{int(min_compliance_ratio*100)}% of P10 non-curtailment generation — safe floor commitment",
            "max_rtc_basis":        "P90 non-curtailment generation — achievable 90% of the time",
            "recommended_basis":    "Max RTC with zero shortfall across all operable (non-PSP-curtailed) blocks",
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
