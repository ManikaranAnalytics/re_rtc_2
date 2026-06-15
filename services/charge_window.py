"""FIFO charge-lot tracking with a 96-block (24-hour) discharge window."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

BLOCKS_PER_WINDOW = 96
BLOCK_HOURS = 0.25


def _normalize_lots(lots: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not lots:
        return []
    normalized: list[dict[str, Any]] = []
    for lot in lots:
        remaining = float(lot.get("remaining_mwh", 0.0))
        if remaining <= 1e-9:
            continue
        normalized.append({
            "charged_at": int(lot["charged_at"]),
            "expires_at": int(lot["expires_at"]),
            "remaining_mwh": round(remaining, 6),
            "original_mwh": round(float(lot.get("original_mwh", remaining)), 6),
        })
    return normalized


def seed_lots_from_initial_soc(
    initial_soc_mwh: float,
    global_block_offset: int,
    prev_charge_lots: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build opening charge lots for a day."""
    if prev_charge_lots:
        return _normalize_lots(prev_charge_lots)

    if initial_soc_mwh <= 1e-9:
        return []

    # Unknown lot history — treat opening SoC as one charge just before this day starts.
    charged_at = global_block_offset - 1
    return [{
        "charged_at": charged_at,
        "expires_at": charged_at + BLOCKS_PER_WINDOW,
        "remaining_mwh": round(initial_soc_mwh, 6),
        "original_mwh": round(initial_soc_mwh, 6),
    }]


def process_charge_window_block(
    lots: list[dict[str, Any]],
    global_block: int,
    psp_charge_mw: float,
    psp_discharge_mw: float,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    """
    Update charge lots for one 15-minute block.

    A charge at global block G must be fully discharged before block G + 96,
    otherwise the undischarged balance is counted as expired loss.
    """
    lots = deepcopy(_normalize_lots(lots))

    expired_mwh = 0.0
    valid_lots: list[dict[str, Any]] = []
    for lot in lots:
        if lot["expires_at"] <= global_block:
            expired_mwh += lot["remaining_mwh"]
        else:
            valid_lots.append(lot)
    lots = valid_lots

    discharge_mwh = max(0.0, psp_discharge_mw) * BLOCK_HOURS
    discharged_mwh = 0.0
    remaining_to_allocate = discharge_mwh
    for lot in lots:
        if remaining_to_allocate <= 1e-9:
            break
        take = min(lot["remaining_mwh"], remaining_to_allocate)
        lot["remaining_mwh"] = round(lot["remaining_mwh"] - take, 6)
        remaining_to_allocate -= take
        discharged_mwh += take
    lots = [lot for lot in lots if lot["remaining_mwh"] > 1e-9]

    charge_mwh = max(0.0, psp_charge_mw) * BLOCK_HOURS
    if charge_mwh > 1e-9:
        lots.append({
            "charged_at": global_block,
            "expires_at": global_block + BLOCKS_PER_WINDOW,
            "remaining_mwh": round(charge_mwh, 6),
            "original_mwh": round(charge_mwh, 6),
        })

    outstanding_mwh = round(sum(lot["remaining_mwh"] for lot in lots), 6)

    return lots, {
        "charge_window_expired_mwh": round(expired_mwh, 6),
        "charge_window_discharged_mwh": round(discharged_mwh, 6),
        "charge_window_charged_mwh": round(charge_mwh, 6),
        "charge_window_outstanding_mwh": outstanding_mwh,
    }


def finalize_charge_window(lots: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    """Expire any remaining lots at end of analysis horizon."""
    lots = deepcopy(_normalize_lots(lots))
    expired_mwh = round(sum(lot["remaining_mwh"] for lot in lots), 6)
    return [], expired_mwh
