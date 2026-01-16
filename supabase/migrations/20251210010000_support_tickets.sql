-- Migration: Support Tickets table for Re:amaze integration
-- Created: 2025-12-10

-- Create support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  reamaze_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  subject TEXT,
  message_body TEXT,
  channel TEXT,
  perma_url TEXT,

  -- AI classification
  category TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  summary TEXT NOT NULL,
  urgency TEXT,

  -- Metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_sentiment ON support_tickets(sentiment);
CREATE INDEX IF NOT EXISTS idx_tickets_reamaze_id ON support_tickets(reamaze_id);

-- Enable RLS (Row Level Security) but allow service role full access
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Policy for service role to have full access
CREATE POLICY "Service role full access" ON support_tickets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy for anon/authenticated to read
CREATE POLICY "Allow read access" ON support_tickets
  FOR SELECT
  TO anon, authenticated
  USING (true);
