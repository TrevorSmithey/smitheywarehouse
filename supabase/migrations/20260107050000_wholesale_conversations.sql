-- Wholesale conversations from Reamaze (smitheysales brand)
-- Used for Sales vs Support analysis and VOC reporting

CREATE TABLE IF NOT EXISTS wholesale_conversations (
  id SERIAL PRIMARY KEY,
  reamaze_slug TEXT NOT NULL UNIQUE,
  subject TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,

  -- Customer info
  customer_name TEXT,
  customer_email TEXT,
  customer_company TEXT,

  -- Message content
  first_message TEXT,
  first_message_clean TEXT,
  message_count INTEGER,
  tags TEXT[],

  -- Classification fields
  category TEXT,
  subcategory TEXT,
  sentiment TEXT,
  products_mentioned TEXT[],
  requires_action BOOLEAN,
  resolution_type TEXT,
  is_spam BOOLEAN,
  classification_confidence DOUBLE PRECISION,
  summary TEXT,

  -- Sales vs Support classification (Jan 2026)
  what_they_want TEXT,
  primary_topic TEXT,
  known_category TEXT,  -- Order/Restock, New Business, Payment/Credit, Product Issue, Relationship, Pricing/Terms
  requires TEXT,        -- Sales, Support, Either
  requires_reasoning TEXT,
  complexity TEXT,      -- Simple, Moderate, Complex
  is_noise BOOLEAN DEFAULT FALSE,
  noise_type TEXT,

  -- Metadata
  classified_at TIMESTAMPTZ,
  classification_model TEXT,
  synced_at TIMESTAMPTZ,
  raw_data JSONB
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_wholesale_conversations_created_at ON wholesale_conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_wholesale_conversations_is_noise ON wholesale_conversations(is_noise);
CREATE INDEX IF NOT EXISTS idx_wholesale_conversations_requires ON wholesale_conversations(requires);
CREATE INDEX IF NOT EXISTS idx_wholesale_conversations_known_category ON wholesale_conversations(known_category);
CREATE INDEX IF NOT EXISTS idx_wholesale_conversations_customer_email ON wholesale_conversations(customer_email);
