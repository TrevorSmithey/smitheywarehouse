#!/usr/bin/env python3
"""
Export 2026 budget data to Excel for audit.
Creates multiple tabs: Summary, Retail, Wholesale, Total
"""

import os
import json
import pandas as pd
import requests
from dotenv import load_dotenv

# Load env
load_dotenv('.env.local')

SUPABASE_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_KEY']

def fetch_budgets(year):
    """Fetch all budgets for a year using REST API"""
    url = f"{SUPABASE_URL}/rest/v1/budgets"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}'
    }
    params = {'year': f'eq.{year}', 'select': '*'}
    response = requests.get(url, headers=headers, params=params)
    return response.json()

def pivot_data(data, channel):
    """Pivot data to SKU rows x Month columns"""
    filtered = [d for d in data if d['channel'] == channel]
    if not filtered:
        return pd.DataFrame()

    df = pd.DataFrame(filtered)
    pivot = df.pivot_table(
        index='sku',
        columns='month',
        values='budget',
        aggfunc='sum'
    ).reset_index()

    # Rename columns
    month_names = {1: 'Jan', 2: 'Feb', 3: 'Mar', 4: 'Apr', 5: 'May', 6: 'Jun',
                   7: 'Jul', 8: 'Aug', 9: 'Sep', 10: 'Oct', 11: 'Nov', 12: 'Dec'}
    pivot.columns = ['SKU'] + [month_names.get(c, c) for c in pivot.columns[1:]]

    # Add total column
    month_cols = [c for c in pivot.columns if c != 'SKU']
    pivot['TOTAL'] = pivot[month_cols].sum(axis=1)

    # Sort by SKU
    pivot = pivot.sort_values('SKU').reset_index(drop=True)

    return pivot

def create_summary(data_2025, data_2026):
    """Create summary comparison"""
    rows = []

    for channel in ['retail', 'wholesale', 'total']:
        d25 = sum(d['budget'] for d in data_2025 if d['channel'] == channel)
        d26 = sum(d['budget'] for d in data_2026 if d['channel'] == channel)

        rows.append({
            'Channel': channel.upper(),
            '2025 Total': d25,
            '2026 Total': d26,
            'Change': d26 - d25,
            'Change %': f"{((d26 - d25) / d25 * 100):.1f}%" if d25 > 0 else 'N/A'
        })

    # Grand total
    total_25 = sum(d['budget'] for d in data_2025)
    total_26 = sum(d['budget'] for d in data_2026)
    rows.append({
        'Channel': 'GRAND TOTAL',
        '2025 Total': total_25,
        '2026 Total': total_26,
        'Change': total_26 - total_25,
        'Change %': f"{((total_26 - total_25) / total_25 * 100):.1f}%" if total_25 > 0 else 'N/A'
    })

    return pd.DataFrame(rows)

def main():
    print("Fetching 2025 budget data...")
    data_2025 = fetch_budgets(2025)
    print(f"  Found {len(data_2025)} entries")

    print("Fetching 2026 budget data...")
    data_2026 = fetch_budgets(2026)
    print(f"  Found {len(data_2026)} entries")

    # Create Excel file
    output_path = os.path.expanduser('~/Desktop/Budget_2026_Audit.xlsx')

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:

        # Summary tab
        print("Creating Summary tab...")
        summary = create_summary(data_2025, data_2026)
        summary.to_excel(writer, sheet_name='Summary', index=False)

        # Retail 2026
        print("Creating Retail 2026 tab...")
        retail = pivot_data(data_2026, 'retail')
        retail.to_excel(writer, sheet_name='Retail 2026', index=False)

        # Wholesale 2026
        print("Creating Wholesale 2026 tab...")
        wholesale = pivot_data(data_2026, 'wholesale')
        wholesale.to_excel(writer, sheet_name='Wholesale 2026', index=False)

        # Total 2026
        print("Creating Total 2026 tab...")
        total = pivot_data(data_2026, 'total')
        total.to_excel(writer, sheet_name='Total 2026', index=False)

        # Retail 2025 (for comparison)
        print("Creating Retail 2025 tab...")
        retail_25 = pivot_data(data_2025, 'retail')
        retail_25.to_excel(writer, sheet_name='Retail 2025', index=False)

        # Wholesale 2025
        print("Creating Wholesale 2025 tab...")
        wholesale_25 = pivot_data(data_2025, 'wholesale')
        wholesale_25.to_excel(writer, sheet_name='Wholesale 2025', index=False)

        # Total 2025
        print("Creating Total 2025 tab...")
        total_25 = pivot_data(data_2025, 'total')
        total_25.to_excel(writer, sheet_name='Total 2025', index=False)

    print(f"\n✓ Export complete: {output_path}")
    print("\nTabs created:")
    print("  1. Summary - YoY comparison by channel")
    print("  2. Retail 2026 - New retail budget by SKU")
    print("  3. Wholesale 2026 - New wholesale budget by SKU")
    print("  4. Total 2026 - New out-the-door budget by SKU")
    print("  5. Retail 2025 - Previous year for comparison")
    print("  6. Wholesale 2025 - Previous year for comparison")
    print("  7. Total 2025 - Previous year for comparison")

if __name__ == '__main__':
    main()
