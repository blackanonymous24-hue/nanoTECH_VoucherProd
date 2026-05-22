-- MikroTik timezone offset (minutes from UTC), auto-detected on first sync.
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0;
