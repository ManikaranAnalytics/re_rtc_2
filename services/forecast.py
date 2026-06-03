import os
import pandas as pd
import numpy as np
from services.ingestion import load_power_curve, load_june_data

# Load once when module imports
try:
    df_pc = load_power_curve()
    power_map = dict(zip(df_pc['wind_speed'].round(1), df_pc['power_kw']))
except Exception as e:
    print(f"Error loading power curve: {e}")
    power_map = {}

def get_power_for_wind_speed(speed: float) -> float:
    """Look up turbine power in kW for a given wind speed (m/s).
    Wind speed → power curve lookup (Siemens Gamesa SG 3.15-114).
    Cut-in: 3.0 m/s, Cut-out: 18.0 m/s.
    """
    rounded = round(speed, 1)
    if rounded < 3.0 or rounded > 18.0:
        return 0.0
    return power_map.get(rounded, 0.0)


def _find_segment(block: int, segments: list) -> dict | None:
    """Return the first segment whose startBlock <= block <= endBlock, or None."""
    for seg in segments:
        if seg['startBlock'] <= block <= seg['endBlock']:
            return seg
    return None


def generate_forecast(
    date_str: str,
    wtg_count: int,
    solar_ac_mw: float,
    curtailment_enabled: bool = True,
    curtailment_segments: list | None = None,
    curtailment_start_block: int = 37,
    curtailment_end_block: int = 64,
) -> pd.DataFrame:
    """
    Generates a 96-block generation forecast for a given date in June.

    Wind generation uses a real power curve lookup:
      projected_speed = 0.8 * speed_2025 + 0.2 * speed_2024
      wind_mw = PowerCurve(projected_speed) / 1000 * wtg_count

    Solar generation:
      solar_mw = max(solar_2024, solar_2025, 0) * 0.9 * (solar_ac_mw / 175)

    Curtailment — segment-based:
      Each segment has startBlock, endBlock, and maxMw.
        maxMw == 0  -> full curtailment: wind=0, solar=0
        maxMw  > 0  -> combined cap: scale wind+solar proportionally so their sum <= maxMw
      Blocks not in any segment pass through uncurtailed.

    Backward compatibility:
      If curtailment_segments is None and curtailment_enabled is True, a single full-curtailment
      segment is auto-built from curtailment_start_block / curtailment_end_block.
      If curtailment_enabled is False and curtailment_segments is None, no curtailment is applied.
    """
    # -- Resolve segments -----------------------------------------------------
    if curtailment_segments is not None:
        active_segments = curtailment_segments  # caller supplied explicit segments
    elif curtailment_enabled:
        # Backward-compat: build a single full-curtailment segment
        active_segments = [{
            'startBlock': curtailment_start_block,
            'endBlock':   curtailment_end_block,
            'maxMw':      0.0,
        }]
    else:
        active_segments = []  # curtailment disabled

    june_df = load_june_data()

    try:
        requested_day = pd.to_datetime(date_str).day
    except Exception:
        requested_day = 1

    historical_date_str = f"2024-06-{requested_day:02d}"
    day_data = june_df[june_df['date'] == historical_date_str].copy()

    if len(day_data) == 0:
        # Fallback: match by day-of-month if date column format differs
        june_dates = pd.to_datetime(june_df['date'], errors='coerce')
        day_data = june_df[june_dates.dt.day == requested_day].copy()

    if len(day_data) == 0:
        raise ValueError(
            f"No June historical data for day {requested_day} (looked for {historical_date_str})"
        )

    results = []
    for _, row in day_data.iterrows():
        block = int(row['block'])
        time_str = str(row['time'])

        # Wind: 2026 projection via weighted blend
        speed_2024 = float(row['wind_speed_2024'])
        speed_2025 = float(row['wind_speed_2025'])
        projected_speed = 0.8 * speed_2025 + 0.2 * speed_2024

        # Power curve lookup -> total farm output
        power_per_wtg_kw = get_power_for_wind_speed(projected_speed)
        wind_mw_raw = (power_per_wtg_kw / 1000.0) * wtg_count

        # Solar
        solar_2024 = float(row['solar_2024'])
        solar_2025 = float(row['solar_2025'])
        base_solar = max(solar_2024, solar_2025, 0.0)
        solar_mw_raw = base_solar * 0.9 * (solar_ac_mw / 175.0)

        # -- Segment-based curtailment ----------------------------------------
        seg = _find_segment(block, active_segments)

        if seg is None:
            # Uncurtailed -- pass raw values through
            wind_mw_post  = wind_mw_raw
            solar_mw_post = solar_mw_raw
            curtail_flag         = False
            curtail_partial_flag = False
            curtail_max_mw       = -1.0  # sentinel: no segment

        elif seg['maxMw'] == 0.0:
            # Full curtailment -- both plants zeroed
            wind_mw_post  = 0.0
            solar_mw_post = 0.0
            curtail_flag         = True
            curtail_partial_flag = False
            curtail_max_mw       = 0.0

        else:
            # Partial curtailment -- combined MW cap across both plants
            combined_raw = wind_mw_raw + solar_mw_raw
            cap = float(seg['maxMw'])
            if combined_raw > cap:
                scale = cap / combined_raw
                wind_mw_post  = wind_mw_raw  * scale
                solar_mw_post = solar_mw_raw * scale
            else:
                # Under cap -- no curtailment needed
                wind_mw_post  = wind_mw_raw
                solar_mw_post = solar_mw_raw
            curtail_flag         = False
            curtail_partial_flag = True
            curtail_max_mw       = cap

        results.append({
            "block":                block,
            "time":                 time_str,
            "wind_speed":           round(projected_speed, 2),
            "wind_speed_2024":      round(speed_2024, 2),
            "wind_speed_2025":      round(speed_2025, 2),
            "wind_mw_raw":          round(wind_mw_raw,  4),   # pre-curtailment
            "wind_mw":              round(wind_mw_post, 4),   # post-curtailment
            "solar_mw_raw":         round(solar_mw_raw,  4),
            "solar_mw":             round(solar_mw_post, 4),
            "curtail_flag":         curtail_flag,           # True only for maxMw=0 segments
            "curtail_partial_flag": curtail_partial_flag,   # True for maxMw>0 segments
            "curtail_max_mw":       curtail_max_mw,         # -1=no seg, 0=full, >0=cap
        })

    return pd.DataFrame(results)
