# Smithey Warehouse Dashboard - Team Guide

> Quick reference for the warehouse operations dashboard. What everything means and how to read it.

---

## Dashboard Tabs at a Glance

| Tab | What It Shows | Updates |
|-----|---------------|---------|
| **Inventory** | Stock levels across all warehouses | Every 15 minutes |
| **VOC** | Support tickets from Reamaze | Every 5 minutes |
| **Budget vs Actual** | Sales against monthly targets | Real-time |
| **Assembly** | Manufacturing production vs targets | Daily (manual) |
| **D2C / Fulfillment** | Direct-to-consumer orders and shipping | Hourly |
| **Holiday** | 2024 vs 2025 seasonal comparison | Daily |
| **Marketing** | Email campaign performance | Daily (6am) |
| **Sales** | Wholesale customer health | Manual update |

---

## Key Definitions

### Inventory Terms

#### DOI (Days of Inventory)
**What it means**: How many days until we run out of stock based on our **monthly budget targets**

**Important**: DOI uses our planned sales budgets (from the budgets spreadsheet), NOT actual recent sales velocity. This tells you how long inventory will last if we hit our sales targets.

| DOI | Status | What to Do |
|-----|--------|------------|
| **< 7 days** | Urgent (Red) | Reorder immediately |
| **< 30 days** | Watch (Amber) | Plan reorder soon |
| **< 60 days** | OK (Yellow) | Monitor |
| **60+ days** | Healthy (Green) | All good |
| **BACKORDER** | Critical | We owe customers product |

#### Velocity (Vel)
**What it means**: Average units sold per day (rolling 3-day average)

Example: `12/day` means we sold 36 units in the last 3 days

#### Safety Stock (SS)
**What it means**: Minimum units we want to keep in stock for each SKU

When inventory drops below safety stock, the row pulses amber as a warning.

---

### Row Colors (Inventory Table)

| Color | Meaning |
|-------|---------|
| **Red background** | Negative inventory (backordered) - we owe customers |
| **Pulsing amber** | Below safety stock - needs attention |
| **Normal/zebra** | Stock levels are healthy |

---

### Warehouses

| Name | ShipHero ID |
|------|-------------|
| **Hobson** | 77373 |
| **Selery** | 93742 |
| **Pipefitter** | 120758 |

---

## VOC (Support) Tab

### TOR (Ticket-to-Order Ratio)
**What it means**: Number of support tickets per 100 orders

Example: TOR of 5.2% means 5.2 tickets for every 100 orders placed

| TOR | Status |
|-----|--------|
| **< 3%** | Excellent - low support burden |
| **3-5%** | Normal range |
| **> 5%** | Worth investigating - may indicate issues |

### Sentiment
**What it means**: How customers feel based on ticket content

| Sentiment | Description |
|-----------|-------------|
| **Positive** | Happy customer, praise, thank you |
| **Neutral** | Information request, status check |
| **Negative** | Complaint, frustration, problem |
| **Mixed** | Contains both positive and negative |

### Alert Counts
Highlights that need attention:
- **Quality Issues (Negative)**: Product problems with unhappy customers
- **Delivery Problems**: All shipping/delivery related tickets
- **Return Requests**: All return or exchange requests

### Topic Themes
Groups tickets into categories:
- **Product Issues**: Quality, seasoning, specific product problems
- **Order Management**: Status, cancellations, changes
- **Shipping & Delivery**: Tracking, delays, problems
- **Returns & Exchanges**: Return and exchange requests
- **Product Questions**: Inquiries, recommendations, cooking advice
- **Sales & Promotions**: Discount inquiries, wholesale, factory seconds
- **Positive Feedback**: Compliments and praise

### Pre/Post Purchase Timing
Shows whether tickets come from:
- **Pre-Purchase**: Customers who haven't bought yet (questions before buying)
- **Post-Purchase**: Customers who already bought (support after purchase)

---

## Budget vs Actual Terms

#### Pace
**What it means**: How close we are to hitting our monthly budget target

| Pace | Status |
|------|--------|
| **90%+** | On track (green) |
| **80-89%** | Slight risk (amber) |
| **< 80%** | Behind target (red) |

#### Green Pulse
**What it means**: SKU is **exceeding** its monthly budget - celebrating the win!

---

## Assembly Tab

#### Deficit
**What it means**: How many more units we need to produce to hit our target

#### Progress Bar
Shows how much of the revised manufacturing plan we've completed

---

## D2C / Fulfillment Terms

#### Lead Time
**What it means**: Time from when an order is placed to when it ships

- Under 24 hours = Great
- 24-48 hours = Normal
- Over 48 hours = We're behind

#### Backlog
**What it means**: Orders placed but not yet shipped

High backlog = we need to ship faster

#### Stuck Shipments
**What it means**: Orders shipped more than 7 days ago but not delivered

These need investigation (lost in transit?)

---

## Holiday Tab

Compares this holiday season (2025) to last year (2024) day-by-day:
- **Orders**: Number of orders
- **Revenue**: Dollar sales
- **YoY Delta**: Percentage change vs last year

---

## Marketing (Klaviyo) Tab

### Email Revenue Breakdown

| Metric | What It Means |
|--------|---------------|
| **Campaign Revenue** | Sales from one-time email sends (newsletters, promos) |
| **Flow Revenue** | Sales from automated email sequences (welcome, abandoned cart) |
| **Total Email Revenue** | Campaign + Flow combined |

**Target**: 40-60% split between campaigns and flows is healthy

### Key Email Metrics

| Metric | What It Measures | Healthy Benchmark |
|--------|------------------|-------------------|
| **Open Rate** | % who opened the email | 35%+ is good |
| **Click Rate** | % who clicked a link | 1%+ is good |
| **Revenue Per Recipient (RPR)** | $$$ earned per email sent | $0.10+ is good |
| **Unsubscribe Rate** | % who unsubscribed | Under 0.5% is good |
| **Placed Order Rate** | % who bought something | 0.1%+ is good |

### List Health Score (0-100)
**What it means**: Overall health of our email list

| Score | Rating | Meaning |
|-------|--------|---------|
| **80-100** | Excellent | List is healthy, keep it up |
| **60-79** | Good | Minor issues, monitor |
| **40-59** | Fair | Needs attention |
| **0-39** | Poor | Multiple issues to address |

Based on: delivery rate, bounce rate, unsubscribe rate, and engagement.

### Subscriber Segments

| Segment | Definition |
|---------|------------|
| **120-Day Active** | Opened/clicked an email in last 120 days |
| **365-Day Engaged** | Opened/clicked an email in last year |

### Flow Types

| Flow | What It Does |
|------|--------------|
| **Welcome Series** | Emails to new subscribers |
| **Abandoned Cart** | Emails when someone leaves items in cart |
| **Abandoned Checkout** | Emails when someone starts but doesn't finish checkout |
| **Browse Abandonment** | Emails when someone views products but doesn't buy |
| **Post Purchase** | Thank you and follow-up emails after buying |
| **Win-back** | Emails to re-engage inactive customers |

---

## Sales (Wholesale) Tab

### Customer Health Status

**What it means**: How engaged a wholesale customer is based on their ordering history

| Status | Criteria |
|--------|----------|
| **Thriving** | revenueTrend > 0.1 (revenue up 10%+) |
| **Stable** | default (no other condition matches) |
| **Declining** | revenueTrend < -0.2 (revenue down 20%+) |
| **At Risk** | daysSinceLastOrder > 120 |
| **Churning** | daysSinceLastOrder > 180 |
| **Churned** | daysSinceLastOrder > 365 |
| **One-Time** | orderCount = 1 |
| **Never Ordered** | orderCount = 0 |
| **New** | daysSinceLastOrder = null (data issue) |

### Active vs Total Customers

| Term | Definition |
|------|------------|
| **Active Customers** | Placed an order within selected period (MTD, YTD, etc.) |
| **Total Customers** | All wholesale accounts in the system |

### Customer Segments (by Lifetime Revenue)

| Segment | Revenue Range |
|---------|--------------|
| **Major** | $50,000+ |
| **Large** | $20,000 - $49,999 |
| **Mid** | $10,000 - $19,999 |
| **Small** | $5,000 - $9,999 |
| **Starter** | $2,000 - $4,999 |
| **Minimal** | Under $2,000 |

### Risk Score (0-100)
**What it means**: How likely a customer is to stop ordering

- **0-30**: Low risk - healthy customer
- **30-60**: Medium risk - watch closely
- **60-100**: High risk - needs attention

Higher is worse. Based on days since last order, revenue trends, and account size.

---

## What Updates When?

### Automatic (No Action Needed)
- **Inventory**: Every 15 minutes
- **D2C Orders**: Hourly
- **Support Tickets**: Every 5 minutes
- **Marketing/Klaviyo**: Daily at 6am

### Daily Manual (Trevor)
- **Assembly Data**: Run the "Update Assembly Tracking" script on Desktop
  - This also updates Holiday data automatically

### As Needed (Trevor)
- **Wholesale Data**: Run the NetSuite sync script

---

## Warning Signs to Watch For

### Red Banner at Top
If you see a warning banner about "Data Sync Issues" - data may be stale. Alert Trevor.

### All Zeros
If metrics show all zeros, something probably failed. Check with Trevor.

### "BACKORDER" Status
Any SKU showing BACKORDER needs immediate attention - customers are waiting.

### Pulsing Amber Rows
These SKUs are below safety stock and may sell out soon.

### High Risk Customers (Sales Tab)
Customers with risk score 60+ or status "At Risk", "Churning", or "Churned" need outreach.

---

## Quick Glossary

| Term | Definition |
|------|------------|
| **SKU** | Product code (e.g., Smith-CI-Skil12) |
| **MTD** | Month-to-date (sales so far this month) |
| **YTD** | Year-to-date (sales so far this year) |
| **YoY** | Year-over-year comparison |
| **DOI** | Days of Inventory remaining |
| **Vel** | Sales velocity (units/day) |
| **SS** | Safety Stock threshold |
| **B2B** | Business-to-business (wholesale) |
| **D2C** | Direct-to-consumer (retail website) |
| **RPR** | Revenue Per Recipient (email metric) |
| **AOV** | Average Order Value |

---

## Need Help?

If something looks wrong or you have questions about what you're seeing, reach out to Trevor.

---

*Last Updated: December 2025*
