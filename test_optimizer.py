from services.forecast import generate_forecast
from services.psp_optimizer import optimize_psp_dispatch, calculate_rtc_range

fc = generate_forecast("2026-06-01", wtg_count=15, solar_ac_mw=60.0)
res = optimize_psp_dispatch(fc, rtc_commitment=15.0, roundtrip_loss_pct=20.0, min_compliance_ratio=0.75)
s = res["summary"]
print("=== Optimizer Test ===")
print(f"Compliant blocks : {s['compliant_blocks']}/96")
print(f"Total charged    : {s['total_charged_mwh']} MWh")
print(f"Usable (after loss): {s['psp_usable_charged_mwh']} MWh")
print(f"EOD SoC          : {s['end_soc_mwh']} MWh")
print(f"Min floor        : {s['min_schedule_mw']} MW (75% of 15 = 11.25 expected)")

print("\n=== Manikaran Suggestion Test ===")
rng = calculate_rtc_range(fc, roundtrip_loss_pct=20.0, min_compliance_ratio=0.75)
print(f"Min RTC          : {rng['min_rtc_mw']} MW")
print(f"Recommended (0sf): {rng['recommended_rtc_mw']} MW  <-- must give 96/96 compliant")
print(f"Max (P90)        : {rng['max_rtc_mw']} MW")

# Verify recommended gives 96/96
res2 = optimize_psp_dispatch(fc, rtc_commitment=rng["recommended_rtc_mw"], roundtrip_loss_pct=20.0, min_compliance_ratio=0.75)
print(f"Validate recommended: {res2['summary']['compliant_blocks']}/96 compliant (should be 96)")
