import { useAuth } from "@/contexts/AuthContext";
import { TicketTemplateEditor } from "@/components/TicketTemplateEditor";

export default function TicketTemplate() {
  const { token, isSuperAdmin } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  return (
    <TicketTemplateEditor
      layout="page"
      title="Modèle de ticket"
      subtitle={
        isSuperAdmin
          ? "Modèles intégrés partagés : importer / supprimer pour mettre à jour tous les comptes."
          : "Trois modèles intégrés (fichiers nanoTECH / Mikhmon)"
      }
      loadPath="/api/admin/ticket-template"
      savePath="/api/admin/ticket-template"
      authHeaders={authHeaders}
      enabled={!!token}
      showBroadcastScale={isSuperAdmin}
      showBuiltinTemplatesManager={isSuperAdmin}
    />
  );
}
