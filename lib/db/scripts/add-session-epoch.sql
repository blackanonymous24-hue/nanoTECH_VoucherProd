-- Révocation multi-navigateur / multi-appareil (JWT sid vs session_epoch).
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE collaborateurs ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;
