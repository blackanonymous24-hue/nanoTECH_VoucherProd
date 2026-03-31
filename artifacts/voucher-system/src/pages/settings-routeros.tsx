import { useState, useEffect } from "react";
import { useGetRouterOSConfig, useUpdateRouterOSConfig, useTestRouterOSConnection } from "@workspace/api-client-react";
import { RouterOSConfig } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Wifi, CheckCircle2, XCircle, Loader2, Save, TestTube2, Router, ShieldCheck } from "lucide-react";

export default function SettingsRouterOS() {
  const { toast } = useToast();
  const { data: savedConfig, isLoading } = useGetRouterOSConfig();
  const updateConfig = useUpdateRouterOSConfig();

  const [form, setForm] = useState<RouterOSConfig>({
    enabled: false,
    host: "192.168.88.1",
    port: 80,
    ssl: false,
    user: "admin",
    password: "",
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string; profiles: string[] } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (savedConfig) {
      setForm(savedConfig);
    }
  }, [savedConfig]);

  const { refetch: runTest } = useTestRouterOSConnection({ query: { enabled: false } });

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);
    try {
      const { data } = await runTest();
      if (data) setTestResult(data);
    } catch {
      setTestResult({ success: false, message: "Erreur lors du test de connexion", profiles: [] });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await updateConfig.mutateAsync({ data: form });
      toast({ title: "Configuration enregistrée", description: "Les paramètres RouterOS ont été sauvegardés." });
    } catch {
      toast({ title: "Erreur", description: "Impossible de sauvegarder la configuration.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Router className="h-6 w-6 text-primary" />
          Configuration RouterOS MikroTik
        </h1>
        <p className="text-muted-foreground mt-1">
          Connectez VoucherNet à votre routeur MikroTik pour créer automatiquement les utilisateurs hotspot lors de la génération de vouchers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Intégration RouterOS</CardTitle>
              <CardDescription>Synchronisation automatique des vouchers via l'API REST RouterOS</CardDescription>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="host">Adresse IP / Hôte du routeur</Label>
              <Input
                id="host"
                placeholder="192.168.88.1"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                disabled={!form.enabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                placeholder="80"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || 80 }))}
                disabled={!form.enabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="user">Nom d'utilisateur RouterOS</Label>
              <Input
                id="user"
                placeholder="admin"
                value={form.user}
                onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                disabled={!form.enabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe RouterOS</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                disabled={!form.enabled}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border p-3 bg-muted/30">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Connexion HTTPS (SSL)</p>
              <p className="text-xs text-muted-foreground">Utiliser HTTPS pour chiffrer la communication (port 443 par défaut)</p>
            </div>
            <Switch
              checked={form.ssl}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, ssl: v, port: v ? 443 : 80 }));
              }}
              disabled={!form.enabled}
            />
          </div>

          <Separator />

          {testResult && (
            <div
              className={`flex items-start gap-3 p-3 rounded-md border ${
                testResult.success
                  ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900"
                  : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 min-w-0">
                <p className={`text-sm font-medium ${testResult.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                  {testResult.message}
                </p>
                {testResult.profiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {testResult.profiles.map((p) => (
                      <Badge key={p} variant="outline" className="text-xs bg-white dark:bg-transparent">
                        <Wifi className="h-3 w-3 mr-1" />
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleTest} disabled={isTesting || !form.host}>
              {isTesting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TestTube2 className="h-4 w-4 mr-2" />
              )}
              Tester la connexion
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comment ça fonctionne</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</span>
            <p>Activez l'intégration et entrez l'adresse IP de votre routeur MikroTik ainsi que les identifiants administrateur.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</span>
            <p>Testez la connexion pour vérifier que VoucherNet peut communiquer avec votre routeur via l'API REST RouterOS.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</span>
            <p>Lors de la génération d'un lot de vouchers, chaque code est automatiquement créé en tant qu'utilisateur hotspot dans RouterOS (nom = mot de passe = code du voucher, profil = identifiant MikroTik du forfait).</p>
          </div>
          <div className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">4</span>
            <p>Les vouchers sont créés dans la base de données locale même si RouterOS est inaccessible. Vous pouvez toujours exporter en CSV pour importation manuelle.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
