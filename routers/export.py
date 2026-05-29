from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from services.forecast import generate_forecast
from services.psp_optimizer import optimize_psp_dispatch, calculate_rtc_range
from services.excel_export import build_excel

router = APIRouter()

@router.get("/export/excel")
def export_excel(
    date: str = Query("2026-06-01"),
    wtg_count: int = Query(15, ge=1, le=59),
    solar_ac_mw: float = Query(60.0, ge=5.0, le=175.0),
    rtc_commitment_mw: float = Query(15.0, ge=1.0, le=300.0),
    curtailment_enabled: bool = Query(True),
    curtailment_start_block: int = Query(37, ge=1, le=96),
    curtailment_end_block: int = Query(64, ge=1, le=96),
    roundtrip_loss_pct: float = Query(20.0, ge=0.0, le=50.0),
    min_compliance_ratio: float = Query(0.75, ge=0.5, le=1.0),
    initial_soc_mwh: float = Query(0.0, ge=0.0, le=360.0),
    max_soc_mwh: float = Query(360.0, ge=10.0, le=360.0),
    min_dispatch_mw: float = Query(6.0, ge=0.0, le=60.0),
):
    """
    Generates and returns a downloadable Excel workbook (.xlsx) containing:
    - Sheet 1: Config — all input parameters + Manikaran's Suggestion
    - Sheet 2: Raw Data — 96-block meteorological source data
    - Sheet 3: Dispatch Schedule — 96 blocks with live Excel formulas
    - Sheet 4: Summary — daily KPIs (all formula-driven)
    """
    try:
        forecast_df = generate_forecast(
            date_str=date,
            wtg_count=wtg_count,
            solar_ac_mw=solar_ac_mw,
            curtailment_enabled=curtailment_enabled,
            curtailment_start_block=curtailment_start_block,
            curtailment_end_block=curtailment_end_block,
        )

        dispatch = optimize_psp_dispatch(
            forecast_df=forecast_df,
            rtc_commitment=rtc_commitment_mw,
            initial_soc=initial_soc_mwh,
            max_soc=max_soc_mwh,
            roundtrip_loss_pct=roundtrip_loss_pct,
            min_compliance_ratio=min_compliance_ratio,
            min_dispatch_mw=min_dispatch_mw,
        )

        rtc_range = calculate_rtc_range(
            forecast_df=forecast_df,
            max_soc=max_soc_mwh,
            roundtrip_loss_pct=roundtrip_loss_pct,
            min_compliance_ratio=min_compliance_ratio,
            min_dispatch_mw=min_dispatch_mw,
            initial_soc=initial_soc_mwh,
        )

        excel_bytes = build_excel(
            forecast_df=forecast_df,
            block_results=dispatch["blocks"],
            summary=dispatch["summary"],
            rtc_range=rtc_range,
            rtc_commitment=rtc_commitment_mw,
            wtg_count=wtg_count,
            solar_ac_mw=solar_ac_mw,
            date_str=date,
            initial_soc_mwh=initial_soc_mwh,
            curtailment_enabled=curtailment_enabled,
            curtailment_start_block=curtailment_start_block,
            curtailment_end_block=curtailment_end_block,
            roundtrip_loss_pct=roundtrip_loss_pct,
            min_compliance_ratio=min_compliance_ratio,
        )

        filename = f"RTC_Dispatch_{date}_WTG{wtg_count}_Solar{int(solar_ac_mw)}MW.xlsx"

        return Response(
            content=excel_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel export failed: {str(e)}")
