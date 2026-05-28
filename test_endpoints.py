import requests
import json

BASE_URL = "http://localhost:8000"

def test_root():
    print("Testing Root URL...")
    r = requests.get(f"{BASE_URL}/")
    print(f"Status: {r.status_code}, Response: {r.json()}")
    assert r.status_code == 200

def test_generation():
    print("\nTesting GET /api/generation/{date}...")
    r = requests.get(f"{BASE_URL}/api/generation/2026-06-01", params={"wtg_count": 10, "solar_ac_mw": 50})
    print(f"Status: {r.status_code}")
    data = r.json()
    print(f"Returned {len(data)} blocks. First block: {data[0]}")
    assert r.status_code == 200
    assert len(data) == 96

def test_schedule():
    print("\nTesting POST /api/schedule...")
    payload = {
        "date": "2026-06-01",
        "wtg_count": 15,
        "solar_ac_mw": 60.0,
        "rtc_commitment_mw": 15.0
    }
    r = requests.post(f"{BASE_URL}/api/schedule", json=payload)
    print(f"Status: {r.status_code}")
    res = r.json()
    print("Summary:")
    for k, v in res["summary"].items():
        print(f"  {k}: {v}")
    
    assert r.status_code == 200
    assert "blocks" in res
    assert "summary" in res
    assert len(res["blocks"]) == 96
    assert res["summary"]["rtc_commitment_mw"] == 15.0

if __name__ == "__main__":
    try:
        test_root()
        test_generation()
        test_schedule()
        print("\nAll endpoints tested successfully!")
    except Exception as e:
        print(f"\nTest failed: {e}")
