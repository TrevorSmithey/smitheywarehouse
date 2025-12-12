# Smithey Warehouse Dashboard - Team Guide

> Quick reference for the warehouse operations dashboard. What everything means and how to read it.

---

## Dashboard Tabs at a Glance

| Tab | What It Shows | Updates |
|-----|---------------|---------|
| **Inventory** | Stock levels across all warehouses | Every 15 minutes |
| **D2C / Fulfillment** | Direct-to-consumer orders and shipping | Hourly |
| **Assembly** | Manufacturing production vs targets | Daily (manual) |
| **Holiday** | 2024 vs 2025 seasonal comparison | Daily |
| **Budget vs Actual** | Sales against monthly targets | Real-time |
| **Sales** | Wholesale customer health | Manual update |

---

## Key Definitions

### Inventory Terms

#### DOI (Days of Inventory)
**What it means**: How many days until we run out of stock at current sales pace

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

### Warehouse Abbreviations

| Name | Location | Products |
|------|----------|----------|
| **Hobson** | Hobson, MT | Main cast iron/carbon steel |
| **Selery** | Selery location | Cast iron/carbon steel |
| **Pipefitter** | Pipefitter location | Various |

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

## Wholesale Customer Health

| Status | What It Means |
|--------|---------------|
| **Thriving** | Active customer, ordered recently |
| **Stable** | Regular customer, healthy relationship |
| **Declining** | Order frequency dropping |
| **At Risk** | 120-180 days since last order - reach out! |
| **Churning** | 180-365 days since last order - urgent outreach |
| **Churned** | Over a year since last order - may need win-back campaign |

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

## Holiday Tab

Compares this holiday season (2025) to last year (2024) day-by-day:
- **Orders**: Number of orders
- **Revenue**: Dollar sales
- **YoY Delta**: Percentage change vs last year

---

## What Updates When?

### Automatic (No Action Needed)
- **Inventory**: Every 15 minutes
- **D2C Orders**: Hourly
- **Support Tickets**: Every 5 minutes

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

---

## Quick Glossary

| Term | Definition |
|------|------------|
| **SKU** | Product code (e.g., Smith-CI-Skil12) |
| **MTD** | Month-to-date (sales so far this month) |
| **YoY** | Year-over-year comparison |
| **DOI** | Days of Inventory remaining |
| **Vel** | Sales velocity (units/day) |
| **SS** | Safety Stock threshold |
| **B2B** | Business-to-business (wholesale) |
| **D2C** | Direct-to-consumer (retail website) |

---

## Need Help?

If something looks wrong or you have questions about what you're seeing, reach out to Trevor.

---

*Last Updated: December 2025*
