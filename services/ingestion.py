import os
import pandas as pd
import numpy as np

# Define paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EXCEL_PATH = os.path.join(DATA_DIR, "wind_speed_data.xlsx")

POWER_CURVE_CSV = os.path.join(DATA_DIR, "power_curve.csv")
JUNE_DATA_CSV = os.path.join(DATA_DIR, "june_data.csv")

def parse_and_cache_excel():
    """
    Parses the raw wind_speed_data.xlsx file, cleans the sheets,
    and caches them as lightweight CSV files for instant loading.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    
    if not os.path.exists(EXCEL_PATH):
        raise FileNotFoundError(f"Excel source data file not found at {EXCEL_PATH}")
        
    print("Parsing PowerCurve sheet...")
    df_pc = pd.read_excel(EXCEL_PATH, sheet_name="PowerCurve")
    df_pc.columns = ['wind_speed', 'power_kw']
    df_pc.to_csv(POWER_CURVE_CSV, index=False)
    print(f"Cached power curve to {POWER_CURVE_CSV}")
    
    print("Parsing June data sheet...")
    # Load June sheet
    df_june = pd.read_excel(EXCEL_PATH, sheet_name="June")
    
    # We want rows 1 to 2880 (1-based index 1:2881 in pandas)
    # The actual data starts at index 1 of df_june. Row 0 contains label headers.
    data_rows = df_june.iloc[1:2881].copy()
    
    # Extract columns by index to avoid header naming issues
    # Col 0: Date
    # Col 1: Time Block (Time)
    # Col 2: Wind Speed 2024
    # Col 3: Wind Speed 2025
    # Col 14 (Index 14): Solar Net Generation 2024
    # Col 15 (Index 15): Solar Net Generation 2025
    # Col 17 (Index 17): Time Block Number (TB 1-96)
    
    clean_df = pd.DataFrame()
    clean_df['date'] = pd.to_datetime(data_rows.iloc[:, 0]).dt.strftime('%Y-%m-%d')
    clean_df['time'] = data_rows.iloc[:, 1].astype(str)
    clean_df['block'] = pd.to_numeric(data_rows.iloc[:, 17], errors='coerce').astype(int)
    clean_df['wind_speed_2024'] = pd.to_numeric(data_rows.iloc[:, 2], errors='coerce').fillna(0.0)
    clean_df['wind_speed_2025'] = pd.to_numeric(data_rows.iloc[:, 3], errors='coerce').fillna(0.0)
    clean_df['solar_2024'] = pd.to_numeric(data_rows.iloc[:, 14], errors='coerce').fillna(0.0)
    clean_df['solar_2025'] = pd.to_numeric(data_rows.iloc[:, 15], errors='coerce').fillna(0.0)
    
    clean_df.to_csv(JUNE_DATA_CSV, index=False)
    print(f"Cached June data to {JUNE_DATA_CSV}")

def load_power_curve():
    """Loads the cached power curve from CSV."""
    if not os.path.exists(POWER_CURVE_CSV):
        parse_and_cache_excel()
    return pd.read_csv(POWER_CURVE_CSV)

def load_june_data():
    """Loads the cached June data from CSV."""
    if not os.path.exists(JUNE_DATA_CSV):
        parse_and_cache_excel()
    return pd.read_csv(JUNE_DATA_CSV)

if __name__ == "__main__":
    # Test script execution
    parse_and_cache_excel()
    pc = load_power_curve()
    jd = load_june_data()
    print("Power Curve Sample:\n", pc.head(3))
    print("June Data Sample:\n", jd.head(3))
