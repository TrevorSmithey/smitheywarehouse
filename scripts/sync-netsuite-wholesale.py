#!/usr/bin/env python3
"""
NetSuite Wholesale Data Sync
Streams wholesale transactions (Cash Sales + Invoices) and customers from NetSuite to Supabase.

This script handles:
- ~1,018 wholesale customers
- ~7,282 transactions (5,371 CashSale + 1,911 CustInvc)
- ~333,195 line items with SKUs, quantities, prices
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

def sync_customers():
    """Sync ALL wholesale customers from NetSuite to Supabase.

    Pulls all business customers (isperson='F') except D2C accounts (entityid 493 and 2501).
    This includes customers who have never placed an order - valuable leads for sales team.
    """
    print("\n" + "="*70)
    print("SYNCING WHOLESALE CUSTOMERS (ALL - INCLUDING NEVER ORDERED)")
    print("="*70)

    ns_url = f"https://{NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"

    all_customers = []
    offset = 0
    limit = 1000

    while True:
        # Get ALL business customers except D2C accounts
        # c.id 493 = old D2C default, c.id 2501 = current D2C customer
        # Note: c.id is the internal NetSuite customer ID, c.entityid is the visible entity number
        query = {
            "q": f"""
            SELECT DISTINCT
                c.id,
                c.entityid,
                c.companyname,
                c.altname,
                c.email,
                c.phone,
                c.category,
                c.isinactive,
                c.datecreated,
                c.firstsaledate,
                c.lastsaledate,
                c.parent,
                c.url
            FROM customer c
            WHERE c.isperson = 'F'
            AND c.id NOT IN (493, 2501)
            ORDER BY c.companyname
            OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY
            """
        }

        response = make_ns_request(ns_url, method='POST', body=query)

        if response is None or response.status_code != 200:
            print(f"Error fetching customers at offset {offset}")
            break

        data = response.json()
        items = data.get('items', [])

        if not items:
            break

        all_customers.extend(items)
        print(f"  Fetched {len(all_customers)} customers...")

        if len(items) < limit:
            break

        offset += limit
        time.sleep(0.3)

    print(f"\nTotal customers from NetSuite: {len(all_customers)}")

    # Transform and upsert to Supabase
    batch_size = 100
    for i in range(0, len(all_customers), batch_size):
        batch = all_customers[i:i+batch_size]

        records = []
        for c in batch:
            records.append({
                'ns_id': c['id'],
                'entityid': c['entityid'],
                'companyname': c['companyname'],
                'altname': c.get('altname'),
                'email': c.get('email'),
                'phone': c.get('phone'),
                'category': c.get('category'),
                'isinactive': c.get('isinactive'),
                'datecreated': c.get('datecreated'),
                'firstsaledate': c.get('firstsaledate'),
                'lastsaledate': c.get('lastsaledate'),
                'parent': c.get('parent'),
                'url': c.get('url')
            })

        response = supabase_request('ns_wholesale_customers', method='POST', data=records)

        if response.status_code not in [200, 201, 204]:
            print(f"  Error upserting batch {i//batch_size + 1}: {response.text[:200]}")
        else:
            print(f"  Upserted batch {i//batch_size + 1} ({len(records)} records)")

    print(f"\nCustomer sync complete: {len(all_customers)} customers")
    return len(all_customers)

def sync_transactions():
    """Sync wholesale transactions and line items from NetSuite to Supabase"""
    print("\n" + "="*70)
    print("SYNCING WHOLESALE TRANSACTIONS & LINE ITEMS")
    print("="*70)

    ns_url = f"https://{NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql"

    # First, get all transactions
    print("\nStep 1: Fetching transactions...")
    all_transactions = []
    offset = 0
    limit = 1000

    while True:
        query = {
            "q": f"""
            SELECT DISTINCT
                t.id as transaction_id,
                t.tranid,
                t.type as transaction_type,
                t.trandate,
                t.foreigntotal as transaction_total,
                t.status,
                c.id as customer_id,
                c.entityid as customer_entityid,
                c.companyname as customer_name
            FROM transaction t
            JOIN customer c ON t.entity = c.id
            WHERE c.isperson = 'F'
            AND c.entityid != '493'
            AND t.type IN ('CashSale', 'CustInvc')
            ORDER BY t.trandate, t.id
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

        all_transactions.extend(items)
        print(f"  Fetched {len(all_transactions)} transactions...")

        if len(items) < limit:
            break

        offset += limit
        time.sleep(0.3)

    print(f"\nTotal transactions from NetSuite: {len(all_transactions)}")

    # Upsert transactions to Supabase
    print("\nStep 2: Upserting transactions to Supabase...")
    batch_size = 100
    for i in range(0, len(all_transactions), batch_size):
        batch = all_transactions[i:i+batch_size]

        records = []
        for t in batch:
            records.append({
                'ns_transaction_id': t['transaction_id'],
                'tran_id': t['tranid'],
                'transaction_type': t['transaction_type'],
                'tran_date': t['trandate'],
                'foreign_total': float(t['transaction_total']) if t.get('transaction_total') else None,
                'status': t.get('status'),
                'ns_customer_id': t['customer_id']
            })

        response = supabase_request('ns_wholesale_transactions', method='POST', data=records)

        if response.status_code not in [200, 201, 204]:
            print(f"  Error upserting transaction batch {i//batch_size + 1}: {response.text[:200]}")
        else:
            print(f"  Upserted transaction batch {i//batch_size + 1} ({len(records)} records)")

    # Now fetch and sync line items
    print("\nStep 3: Fetching line items...")
    all_line_items = []
    offset = 0
    batch_num = 0

    while True:
        batch_num += 1
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
            JOIN customer c ON t.entity = c.id
            WHERE c.isperson = 'F'
            AND c.entityid != '493'
            AND t.type IN ('CashSale', 'CustInvc')
            AND tl.mainline = 'F'
            AND tl.item IS NOT NULL
            ORDER BY t.id, tl.linesequencenumber
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

        # Upsert this batch directly to save memory
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

        response = supabase_request('ns_wholesale_line_items', method='POST', data=records)

        total_so_far = offset + len(items)

        if response.status_code not in [200, 201, 204]:
            print(f"  Batch {batch_num}: Error - {response.text[:100]}")
        else:
            print(f"  Batch {batch_num}: {len(items)} rows | Total: {total_so_far:,}")

        if len(items) < limit:
            break

        offset += limit
        time.sleep(0.3)

    total_lines = offset + (len(items) if items else 0)
    print(f"\nLine item sync complete: {total_lines:,} line items")

    return len(all_transactions), total_lines

def main():
    print("="*70)
    print("NETSUITE WHOLESALE DATA SYNC")
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

    # Sync data
    customer_count = sync_customers()
    txn_count, line_count = sync_transactions()

    print("\n" + "="*70)
    print("SYNC COMPLETE")
    print("="*70)
    print(f"Customers synced: {customer_count:,}")
    print(f"Transactions synced: {txn_count:,}")
    print(f"Line items synced: {line_count:,}")
    print(f"Completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
