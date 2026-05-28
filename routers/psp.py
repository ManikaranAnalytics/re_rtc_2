from fastapi import APIRouter

router = APIRouter()

# Technical specs of Orvakallu PSP
PSP_CONFIG = {
    "capacity_mwh": 360.0,
    "max_charge_mw": 60.0,
    "max_discharge_mw": 50.0,
    "transmission_loss_mw": 10.0,
    "max_cycles_per_day": 2.0,
    "efficiency_percent": 83.33,
    "location": "Orvakallu, Andhra Pradesh",
    "grid_connectivity_kv": 765
}

@router.get("/status")
def get_psp_status():
    """Returns the operational parameters and static configuration of the PSP."""
    return {
        "status": "Operational",
        "configuration": PSP_CONFIG,
        "current_soc_mwh": 0.0,  # Reset state
        "cycles_completed": 0
    }

@router.post("/reset")
def reset_psp_state():
    """Resets the state of the PSP simulation. In Phase 1, state is simulated per request."""
    return {"message": "PSP state successfully reset", "status": "OK"}
