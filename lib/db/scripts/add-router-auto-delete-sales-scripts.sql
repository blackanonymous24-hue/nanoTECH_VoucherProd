-- Optional router-level behavior:
-- when enabled, MikHMon sales scripts are auto-deleted from MikroTik
-- after successful local DB cache persistence.
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS auto_delete_sales_scripts boolean NOT NULL DEFAULT false;
