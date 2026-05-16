-- Choix explicite du modèle de ticket (intégré ou personnalisé), aligné sur le contenu enregistré.
-- NULL = lignes existantes : le client déduit encore depuis le HTML/PHP.
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS ticket_template_preset text;
