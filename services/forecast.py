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

def generate_forecast(
    date_str: str,
    wtg_count: int,
    solar_ac_mw: float,
    curtailment_enabled: bool = True,
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

    Curtailment zeroes both wind and solar in the configured block range.
    """
    june_df = load_june_data()

    try:
        requested_day = pd.to_datetime(date_str).day
    except Exception:
        requested_day = 1

    historical_date_str = f"2024-06-{requested_day:02d}"
    day_data = june_df[june_df['date'] == historical_date_str].copy()

    if len(day_data) == 0:
        day_data = june_df.iloc[0:96].copy()

    results = []
    for _, row in day_data.iterrows():
        block = int(row['block'])
        time_str = str(row['time'])

        # Wind: 2026 projection via weighted blend
        speed_2024 = float(row['wind_speed_2024'])
        speed_2025 = float(row['wind_speed_2025'])
        projected_speed = 0.8 * speed_2025 + 0.2 * speed_2024

        # Power curve lookup → total farm output
        power_per_wtg_kw = get_power_for_wind_speed(projected_speed)
        wind_mw = (power_per_wtg_kw / 1000.0) * wtg_count

        # Solar
        solar_2024 = float(row['solar_2024'])
        solar_2025 = float(row['solar_2025'])
        base_solar = max(solar_2024, solar_2025, 0.0)
        solar_mw_projected = base_solar * 0.9 * (solar_ac_mw / 175.0)

        # Curtailment
        is_curtailment = (
            curtailment_enabled
            and curtailment_start_block <= block <= curtailment_end_block
        )
        wind_mw_post  = 0.0 if is_curtailment else wind_mw
        solar_mw_post = 0.0 if is_curtailment else solar_mw_projected

        results.append({
            "block":          block,
            "time":           time_str,
            "wind_speed":     round(projected_speed, 2),
            "wind_speed_2024": round(speed_2024, 2),
            "wind_speed_2025": round(speed_2025, 2),
            "wind_mw_raw":    round(wind_mw, 4),           # pre-curtailment
            "wind_mw":        round(wind_mw_post, 4),      # post-curtailment
            "solar_mw_raw":   round(solar_mw_projected, 4),
            "solar_mw":       round(solar_mw_post, 4),
            "curtail_flag":   is_curtailment,
        })

    return pd.DataFrame(results)
