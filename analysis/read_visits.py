# Read the synced Field Visit Log from the Google Sheet and summarise.
# pip install pandas ; set SHEET_ID (sheet must be viewable to anyone with link)
import pandas as pd
SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE"
df = pd.read_csv(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv")
print("Total visits:", len(df), "\n")
print("Visits by field staff:\n", df["staff_name"].value_counts(), "\n")
df["week"] = pd.to_datetime(df["visit_date"]).dt.strftime("%Y-W%U")
print("Visits per staff per week:\n", df.groupby(["staff_name","week"]).size(), "\n")
print("By crop stage:\n", df["crop_stage"].value_counts(), "\n")
print("By condition:\n", df["condition"].value_counts())
