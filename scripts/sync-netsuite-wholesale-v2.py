#!/usr/bin/env python3
"""
NetSuite Wholesale Data Sync V2
- Only syncs transactions for known wholesale customers (not all business customers)
- Upserts to Supabase as it goes (no memory accumulation)
- Starts from most recent and goes backward
"""

import os
import time
import hmac
import hashlib
import base64
import urllib.parse
import secrets
import requests
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv('/Users/trevorfunderburk/.netsuite-credentials.env')
load_dotenv('/Users/trevorfunderburk/smitheywarehouse/.env.local')

# NetSuite credentials
NS_ACCOUNT_ID = os.environ.get('NS_ACCOUNT_ID', '9649233')
NS_CONSUMER_KEY = os.environ.get('NS_CONSUMER_KEY')
NS_CONSUMER_SECRET = os.environ.get('NS_CONSUMER_SECRET')
NS_TOKEN_ID = os.environ.get('NS_TOKEN_ID')
NS_TOKEN_SECRET = os.environ.get('NS_TOKEN_SECRET')

# Supabase credentials
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

def make_ns_request(url, method='POST', body=None, retries=3):
    """Make authenticated request to NetSuite REST API"""
    for attempt in range(retries):
        oauth_params = {
            'oauth_consumer_key': NS_CONSUMER_KEY,
            'oauth_token': NS_TOKEN_ID,
            'oauth_signature_method': 'HMAC-SHA256',
            'oauth_timestamp': str(int(time.time())),
            'oauth_nonce': secrets.token_hex(16),
            'oauth_version': '1.0'
        }

        params_string = '&'.join(f"{k}={urllib.parse.quote(v, safe='')}" for k, v in sorted(oauth_params.items()))
        base_string = f"{method}&{urllib.parse.quote(url.split('?')[0], safe='')}&{urllib.parse.quote(params_string, safe='')}"
        signing_key = f"{urllib.parse.quote(NS_CONSUMER_SECRET, safe='')}&{urllib.parse.quote(NS_TOKEN_SECRET, safe='')}"
        signature = base64.b64encode(hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha256).digest()).decode()
        oauth_params['oauth_signature'] = signature

        auth_header = 'OAuth realm="' + NS_ACCOUNT_ID + '", ' + ', '.join(
            f'{k}="{urllib.parse.quote(v, safe="")}"' for k, v in oauth_params.items()
        )

        headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Prefer': 'transient'
        }

        try:
            if method == 'POST':
                response = requests.post(url, headers=headers, json=body, timeout=60)
            else:
                response = requests.get(url, headers=headers, timeout=60)

            if response.status_code == 429:
                print(f"    Rate limited, waiting 30s...")
                time.sleep(30)
                continue
            return response
        except Exception as e:
            print(f"    Request error: {e}, retrying...")
            time.sleep(5)
    return None

def supabase_request(endpoint, method='GET', data=None):
    """Make request to Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }

    if method == 'GET':
        response = requests.get(url, headers=headers)
    elif method == 'POST':
        headers['Prefer'] = 'resolution=merge-duplicates,return=minimal'
        response = requests.post(url, headers=headers, json=data)
    elif method == 'DELETE':
        response = requests.delete(url, headers=headers)

    return response

def get_wholesale_customer_ids():
    """Get the list of wholesale customer IDs from Supabase"""
    print("Fetching wholesale customer IDs from Supabase...")
    response = supabase_request('ns_wholesale_customers?select=ns_id')
    if response.status_code == 200:
        customers = response.json()
        ids = [c['ns_id'] for c in customers]
        print(f"  Found {len(ids)} wholesale customers")
        return ids
    else:
        print(f"  Error: {response.text[:200]}")
        return []

def sync_transactions_streaming():
    """Sync wholesale transactions - streaming to Supabase as we go"""
    print("\n" + "="*70)
    print("SYNCING WHOLESALE TRANSACTIONS (STREAMING)")
    print("="*70)

    # Get wholesale customer IDs
    customer_ids = get_wholesale_customer_ids()
    if not customer_ids:
        print("No wholesale customers found. Run customer sync first.")
        return 0, 0

    # Format for SQL IN clause
    customer_ids_str = ','.join(str(id) for id in customer_ids)

    ns_url = f"https://{NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"

    offset = 0
    limit = 1000
    batch_num = 0
    total_transactions = 0
    total_line_items = 0

    print(f"\nFetching transactions for {len(customer_ids)} wholesale customers...")
    print("Order: Most recent first (DESC)\n")

    while True:
        batch_num += 1

        # Query transactions - ONLY for wholesale customers, most recent first
        query = {
            "q": f"""
            SELECT DISTINCT
                t.id as transaction_id,
                t.tranid,
                t.type as transaction_type,
                t.trandate,
                t.foreigntotal as transaction_total,
                t.status,
                t.entity as customer_id
            FROM transaction t
            WHERE t.entity IN ({customer_ids_str})
            AND t.type IN ('CashSale', 'CustInvc')
            ORDER BY t.trandate DESC, t.id DESC
            OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
            """
        }

        response = make_ns_request(ns_url, method='POST', body=query)

        if response is None or response.status_code != 200:
            print(f"Error fetching transactions at offset {offset}")
            if response:
                print(f"  Error: {response.text[:200]}")
            break

        data = response.json()
        items = data.get('items', [])

        if not items:
            break

        # Transform and upsert transactions immediately
        records = []
        for t in items:
            records.append({
                'ns_transaction_id': t['transaction_id'],
                'tran_id': t['tranid'],
                'transaction_type': t['transaction_type'],
                'tran_date': t['trandate'],
                'foreign_total': float(t['transaction_total']) if t.get('transaction_total') else None,
                'status': t.get('status'),
                'ns_customer_id': t['customer_id']
            })

        sb_response = supabase_request('ns_wholesale_transactions', method='POST', data=records)

        if sb_response.status_code not in [200, 201, 204]:
            print(f"  Batch {batch_num}: ERROR - {sb_response.text[:100]}")
        else:
            total_transactions += len(records)
            # Show date range for this batch
            dates = [r['tran_date'] for r in records if r['tran_date']]
            date_range = f"{min(dates)} to {max(dates)}" if dates else "N/A"
            print(f"  Batch {batch_num}: {len(records)} transactions | Total: {total_transactions:,} | Dates: {date_range}")

        if len(items) < limit:
            break

        offset += limit
        time.sleep(0.3)

    print(f"\nTransaction sync complete: {total_transactions:,} transactions")

    # Now sync line items
    print("\n" + "-"*70)
    print("SYNCING LINE ITEMS (STREAMING)")
    print("-"*70)

    offset = 0
    batch_num = 0

    while True:
        batch_num += 1

        # Query line items - ONLY for wholesale customers, most recent first
        query = {
            "q": f"""
            SELECT
                t.id as transaction_id,
                tl.id as line_id,
                tl.item as item_id,
                BUILTIN.DF(tl.item) as sku,
                tl.quantity,
                tl.rate,
                tl.netamount,
                tl.foreignamount,
                tl.itemtype
            FROM transactionline tl
            JOIN transaction t ON tl.transaction = t.id
            WHERE t.entity IN ({customer_ids_str})
            AND t.type IN ('CashSale', 'CustInvc')
            AND tl.mainline = 'F'
            AND tl.item IS NOT NULL
            ORDER BY t.trandate DESC, t.id DESC, tl.linesequencenumber
            OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
            """
        }

        response = make_ns_request(ns_url, method='POST', body=query)

        if response is None or response.status_code != 200:
            print(f"Error fetching line items at offset {offset}")
            if response:
                print(f"  Error: {response.text[:200]}")
            break

        data = response.json()
        items = data.get('items', [])

        if not items:
            break

        # Transform and upsert line items immediately
        records = []
        for li in items:
            records.append({
                'ns_line_id': li['line_id'],
                'ns_transaction_id': li['transaction_id'],
                'ns_item_id': li.get('item_id'),
                'sku': li.get('sku', 'UNKNOWN'),
                'quantity': int(li['quantity']) if li.get('quantity') else 0,
                'rate': float(li['rate']) if li.get('rate') else None,
                'net_amount': float(li['netamount']) if li.get('netamount') else None,
                'foreign_amount': float(li['foreignamount']) if li.get('foreignamount') else None,
                'item_type': li.get('itemtype')
            })

        sb_response = supabase_request('ns_wholesale_line_items', method='POST', data=records)

        if sb_response.status_code not in [200, 201, 204]:
            print(f"  Batch {batch_num}: ERROR - {sb_response.text[:100]}")
        else:
            total_line_items += len(records)
            print(f"  Batch {batch_num}: {len(records)} line items | Total: {total_line_items:,}")

        if len(items) < limit:
            break

        offset += limit
        time.sleep(0.3)

    print(f"\nLine item sync complete: {total_line_items:,} line items")

    return total_transactions, total_line_items

def main():
    print("="*70)
    print("NETSUITE WHOLESALE DATA SYNC V2")
    print("="*70)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"NetSuite Account: {NS_ACCOUNT_ID}")
    print(f"Supabase URL: {SUPABASE_URL}")

    # Test connections
    print("\nTesting NetSuite connection...")
    ns_url = f"https://{NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"
    test_response = make_ns_request(ns_url, method='POST', body={"q": "SELECT 1"})
    if test_response and test_response.status_code == 200:
        print("  NetSuite connection OK")
    else:
        print("  NetSuite connection FAILED")
        return

    print("\nTesting Supabase connection...")
    test_response = supabase_request('ns_wholesale_customers?limit=1')
    if test_response.status_code == 200:
        print("  Supabase connection OK")
    else:
        print(f"  Supabase connection FAILED: {test_response.text[:200]}")
        return

    # Sync data (customers should already be synced)
    txn_count, line_count = sync_transactions_streaming()

    print("\n" + "="*70)
    print("SYNC COMPLETE")
    print("="*70)
    print(f"Transactions synced: {txn_count:,}")
    print(f"Line items synced: {line_count:,}")
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
