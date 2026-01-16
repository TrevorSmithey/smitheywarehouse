-- ============================================================================
-- RESTORATION TRACKING SYSTEM
-- ============================================================================
-- Tracks the full lifecycle of restoration orders:
-- Order → Label Sent → Customer Ships → Delivered → Received → Restoration → Shipped → Delivered
--
-- Key features:
-- - Links to Aftership returns via aftership_return_id
-- - Full audit trail via restoration_events table
-- - Status-based workflow with timestamps at each stage
-- ============================================================================

-- Primary restoration tracking table
CREATE TABLE IF NOT EXISTS restorations (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) UNIQUE,

  -- Aftership linkage
  aftership_return_id TEXT UNIQUE,
  rma_number TEXT,

  -- Physical tracking (magnet number assigned at warehouse)
  magnet_number TEXT,

  -- Current state (denormalized for fast dashboard queries)
  -- Values: pending_label, label_sent, in_transit_inbound, delivered_warehouse,
  --         received, at_restoration, ready_to_ship, shipped, delivered, cancelled
  status TEXT NOT NULL DEFAULT 'pending_label',

  -- Stage timestamps (populated as order progresses)
  label_sent_at TIMESTAMPTZ,              -- When Aftership label was generated
  customer_shipped_at TIMESTAMPTZ,        -- When tracking shows first pickup scan
  delivered_to_warehouse_at TIMESTAMPTZ,  -- When Aftership shows delivered (auto)
  received_at TIMESTAMPTZ,                -- When team checks in item (manual)
  sent_to_restoration_at TIMESTAMPTZ,     -- When handed to restoration crew (manual)
  back_from_restoration_at TIMESTAMPTZ,   -- When returned from restoration (manual)
  shipped_at TIMESTAMPTZ,                 -- When Shopify order fulfilled (auto)
  delivered_at TIMESTAMPTZ,               -- When delivered to customer (auto from EasyPost)

  -- Return shipment tracking (inbound to warehouse)
  return_tracking_number TEXT,
  return_carrier TEXT,
  return_tracking_status TEXT,  -- Latest status from Aftership

  -- Metadata
  is_pos BOOLEAN DEFAULT FALSE,  -- POS orders skip label stages
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,      -- 'timeout', 'refunded', 'customer_cancelled', 'other'
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail for all state changes
CREATE TABLE IF NOT EXISTS restoration_events (
  id BIGSERIAL PRIMARY KEY,
  restoration_id BIGINT REFERENCES restorations(id) ON DELETE CASCADE,

  -- Event info
  event_type TEXT NOT NULL,
  -- Types: label_created, label_sent, tracking_update, delivered_warehouse,
  --        checked_in, sent_to_restoration, back_from_restoration,
  --        shipped, delivered, cancelled, note_added, status_override

  event_timestamp TIMESTAMPTZ NOT NULL,
  event_data JSONB,  -- Additional context (e.g., tracking details, previous status)

  -- Source tracking
  source TEXT NOT NULL,  -- 'aftership_webhook', 'shopify_webhook', 'easypost', 'manual', 'system'
  created_by TEXT,       -- User identifier or 'system'

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast status-based queries for dashboard pipeline
CREATE INDEX idx_restorations_status ON restorations(status);

-- Lookup by order
CREATE INDEX idx_restorations_order_id ON restorations(order_id);

-- Lookup by Aftership return ID (for webhook processing)
CREATE INDEX idx_restorations_aftership_id ON restorations(aftership_return_id)
  WHERE aftership_return_id IS NOT NULL;

-- Lookup by return tracking number
CREATE INDEX idx_restorations_return_tracking ON restorations(return_tracking_number)
  WHERE return_tracking_number IS NOT NULL;

-- Event queries
CREATE INDEX idx_restoration_events_restoration_id ON restoration_events(restoration_id);
CREATE INDEX idx_restoration_events_type ON restoration_events(event_type);
CREATE INDEX idx_restoration_events_timestamp ON restoration_events(event_timestamp);

-- Compound index for dashboard views (active restorations by status)
CREATE INDEX idx_restorations_active_status ON restorations(status, created_at)
  WHERE status NOT IN ('delivered', 'cancelled');

-- Index for overdue alerts
CREATE INDEX idx_restorations_delivered_not_received ON restorations(delivered_to_warehouse_at)
  WHERE status = 'delivered_warehouse' AND received_at IS NULL;

-- Index for timeout candidates (8 weeks = 56 days)
CREATE INDEX idx_restorations_timeout_candidates ON restorations(created_at)
  WHERE status IN ('pending_label', 'label_sent', 'in_transit_inbound')
    AND cancelled_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_restoration_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER restorations_updated_at
  BEFORE UPDATE ON restorations
  FOR EACH ROW
  EXECUTE FUNCTION update_restoration_timestamp();

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Get restoration pipeline counts by status
CREATE OR REPLACE FUNCTION get_restoration_pipeline_counts()
RETURNS TABLE (
  status TEXT,
  count BIGINT,
  oldest_days INTEGER,
  avg_days_in_status NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.status,
    COUNT(*)::BIGINT as count,
    EXTRACT(DAY FROM (NOW() - MIN(
      CASE r.status
        WHEN 'pending_label' THEN r.created_at
        WHEN 'label_sent' THEN r.label_sent_at
        WHEN 'in_transit_inbound' THEN r.customer_shipped_at
        WHEN 'delivered_warehouse' THEN r.delivered_to_warehouse_at
        WHEN 'received' THEN r.received_at
        WHEN 'at_restoration' THEN r.sent_to_restoration_at
        WHEN 'ready_to_ship' THEN r.back_from_restoration_at
        ELSE r.created_at
      END
    )))::INTEGER as oldest_days,
    ROUND(AVG(EXTRACT(DAY FROM (NOW() -
      CASE r.status
        WHEN 'pending_label' THEN r.created_at
        WHEN 'label_sent' THEN r.label_sent_at
        WHEN 'in_transit_inbound' THEN r.customer_shipped_at
        WHEN 'delivered_warehouse' THEN r.delivered_to_warehouse_at
        WHEN 'received' THEN r.received_at
        WHEN 'at_restoration' THEN r.sent_to_restoration_at
        WHEN 'ready_to_ship' THEN r.back_from_restoration_at
        ELSE r.created_at
      END
    )))::NUMERIC, 1) as avg_days_in_status
  FROM restorations r
  WHERE r.status NOT IN ('delivered', 'cancelled')
  GROUP BY r.status
  ORDER BY
    CASE r.status
      WHEN 'pending_label' THEN 1
      WHEN 'label_sent' THEN 2
      WHEN 'in_transit_inbound' THEN 3
      WHEN 'delivered_warehouse' THEN 4
      WHEN 'received' THEN 5
      WHEN 'at_restoration' THEN 6
      WHEN 'ready_to_ship' THEN 7
      WHEN 'shipped' THEN 8
      ELSE 9
    END;
END;
$$ LANGUAGE plpgsql;

-- Get restorations needing attention (alerts)
CREATE OR REPLACE FUNCTION get_restoration_alerts()
RETURNS TABLE (
  alert_type TEXT,
  restoration_id BIGINT,
  order_id BIGINT,
  order_name TEXT,
  status TEXT,
  days_overdue INTEGER
) AS $$
BEGIN
  RETURN QUERY

  -- Items delivered but not checked in (>2 days)
  SELECT
    'delivered_not_received'::TEXT as alert_type,
    r.id as restoration_id,
    r.order_id,
    o.order_name,
    r.status,
    EXTRACT(DAY FROM (NOW() - r.delivered_to_warehouse_at))::INTEGER as days_overdue
  FROM restorations r
  JOIN orders o ON r.order_id = o.id
  WHERE r.status = 'delivered_warehouse'
    AND r.received_at IS NULL
    AND r.delivered_to_warehouse_at < NOW() - INTERVAL '2 days'

  UNION ALL

  -- Items at restoration too long (>14 days)
  SELECT
    'restoration_too_long'::TEXT,
    r.id,
    r.order_id,
    o.order_name,
    r.status,
    EXTRACT(DAY FROM (NOW() - r.sent_to_restoration_at))::INTEGER
  FROM restorations r
  JOIN orders o ON r.order_id = o.id
  WHERE r.status = 'at_restoration'
    AND r.sent_to_restoration_at < NOW() - INTERVAL '14 days'

  UNION ALL

  -- Ready to ship but not shipped (>3 days)
  SELECT
    'ready_not_shipped'::TEXT,
    r.id,
    r.order_id,
    o.order_name,
    r.status,
    EXTRACT(DAY FROM (NOW() - r.back_from_restoration_at))::INTEGER
  FROM restorations r
  JOIN orders o ON r.order_id = o.id
  WHERE r.status = 'ready_to_ship'
    AND r.back_from_restoration_at < NOW() - INTERVAL '3 days'

  UNION ALL

  -- 8-week timeout candidates (>56 days old, still waiting)
  SELECT
    'timeout_candidate'::TEXT,
    r.id,
    r.order_id,
    o.order_name,
    r.status,
    EXTRACT(DAY FROM (NOW() - r.created_at))::INTEGER
  FROM restorations r
  JOIN orders o ON r.order_id = o.id
  WHERE r.status IN ('pending_label', 'label_sent', 'in_transit_inbound')
    AND r.cancelled_at IS NULL
    AND r.created_at < NOW() - INTERVAL '56 days'

  ORDER BY days_overdue DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE restorations IS 'Tracks the full lifecycle of restoration orders from order placement through delivery back to customer';
COMMENT ON TABLE restoration_events IS 'Audit trail of all state changes for restorations, with source tracking';

COMMENT ON COLUMN restorations.status IS 'Current workflow status: pending_label → label_sent → in_transit_inbound → delivered_warehouse → received → at_restoration → ready_to_ship → shipped → delivered';
COMMENT ON COLUMN restorations.is_pos IS 'POS orders skip label stages - item is received in person';
COMMENT ON COLUMN restorations.magnet_number IS 'Physical magnet number assigned when item is checked in at warehouse';

COMMENT ON FUNCTION get_restoration_pipeline_counts IS 'Returns count, oldest, and avg days in status for each active status';
COMMENT ON FUNCTION get_restoration_alerts IS 'Returns restorations needing attention based on SLA thresholds';
