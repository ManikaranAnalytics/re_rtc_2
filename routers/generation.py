from fastapi import APIRouter, HTTPException, Query
from services.forecast import generate_forecast
from typing import List, Dict

router = APIRouter()

@router.get("/generation/{date}")
def get_raw_generation(
    date: str,
    wtg_count: int = Query(10, ge=1, le=59),
    solar_ac_mw: float = Query(50.0, ge=5.0, le=175.0)
):
    """
    Returns raw, scaled wind speed, wind generation, and solar generation (pre-PSP dispatch)
    for a given date in June.
    """
    try:
        forecast_df = generate_forecast(
            date_str=date,
            wtg_count=wtg_count,
            solar_ac_mw=solar_ac_mw
        )
        # Convert dataframe to a list of dicts
        return forecast_df.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load raw generation: {str(e)}")
