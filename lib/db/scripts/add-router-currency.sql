-- Devise affichée par routeur (tickets, rapports). Exécuter une fois si vous
-- n'utilisez pas `drizzle-kit push` sur cette machine.
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'FCFA';
